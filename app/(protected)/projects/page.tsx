import { ProjectStatus } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import {
  createProjectFormAction,
  deleteProjectFormAction,
  listProjects,
  updateProjectFormAction
} from "@/lib/actions/projects";
import { requireAuth } from "@/lib/auth";
import { calculateProjectSummary } from "@/lib/calc/projects";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import ProjectsLoading from "./loading";

const projectStatuses = Object.values(ProjectStatus);

const statusVariants = {
  ACTIVE: "active",
  COMPLETED: "adjustment",
  PAUSED: "paused"
} as const;

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    style: "currency",
    currency: "VND"
  }).format(amount);
}

function formatRoi(roi: number | null) {
  return roi === null ? "N/A" : `${roi.toFixed(1)}% ROI`;
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsLoading />}>
      <ProjectsPageContent />
    </Suspense>
  );
}

async function ProjectsPageContent() {
  const user = await requireAuth();
  const [projects, transactions] = await Promise.all([
    listProjects(),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        projectId: { not: null }
      },
      select: {
        id: true,
        projectId: true,
        type: true,
        amount: true
      }
    })
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <PageHeader
          action={
            <a href="#add-project">
              <Button variant="primary">Add Project</Button>
            </a>
          }
          title="Projects"
        />
        <p className="mt-2 text-sm text-slate-600">
          Track project income, expenses, profit, and ROI.
        </p>
      </div>

      <Card title="Add Project">
        <div className="scroll-mt-6" id="add-project" />
        <form
          action={createProjectFormAction}
          className="mt-4 grid gap-3 md:grid-cols-5"
        >
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <Input className="mt-1" name="name" required />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Status</span>
            <Select
              className="mt-1"
              defaultValue={ProjectStatus.ACTIVE}
              name="status"
            >
              {projectStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </label>
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">
              Description
            </span>
            <Input className="mt-1" name="description" placeholder="Optional" />
          </label>
          <div className="md:col-span-5 md:flex md:justify-end">
            <Button className="w-full md:w-auto" type="submit">
              Add Project
            </Button>
          </div>
        </form>
      </Card>

      {projects.length === 0 ? (
        <EmptyState
          cta={
            <a href="#add-project">
              <Button variant="primary">Create Project</Button>
            </a>
          }
          title={
            <>
              No projects yet &mdash; Create your first project
            </>
          }
          subtitle="Group related income and expenses to see profit and ROI."
        />
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="min-w-[48rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Profit / Loss</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((project) => {
                  const projectTransactions = transactions.filter(
                    (transaction) => transaction.projectId === project.id
                  );
                  const summary = calculateProjectSummary(projectTransactions);
                  const updateAction = updateProjectFormAction.bind(
                    null,
                    project.id
                  );
                  const deleteAction = deleteProjectFormAction.bind(
                    null,
                    project.id
                  );

                  return (
                    <tr className="align-top transition hover:bg-slate-50/80" key={project.id}>
                      <td className="px-4 py-3">
                        <form
                          action={updateAction}
                          className="grid min-w-80 gap-2"
                          id={`project-${project.id}`}
                        >
                          <Link
                            className="font-medium text-slate-950 hover:text-primary"
                            href={`/projects/${project.id}`}
                          >
                            {project.name}
                          </Link>
                          <Input
                            className="font-medium"
                            name="name"
                            defaultValue={project.name}
                            required
                          />
                          <Input
                            name="description"
                            defaultValue={project.description ?? ""}
                            placeholder="Description"
                          />
                        </form>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          label={project.status}
                          variant={statusVariants[project.status]}
                        />
                        <Select
                          className="mt-2 block"
                          defaultValue={project.status}
                          form={`project-${project.id}`}
                          name="status"
                        >
                          {projectStatuses.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        {projectTransactions.length > 0 ? (
                          <div>
                            <p
                              className={
                                summary.profit >= 0
                                  ? "font-semibold text-income"
                                  : "font-semibold text-expense"
                              }
                            >
                              {formatMoney(summary.profit)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Income {formatMoney(summary.totalIncome)} /
                              Expense {formatMoney(summary.totalExpense)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatRoi(summary.roi)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">
                            No transactions yet
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            form={`project-${project.id}`}
                            size="sm"
                            variant="secondary"
                            type="submit"
                          >
                            Save
                          </Button>
                          <form action={deleteAction}>
                            <Button
                              size="sm"
                              variant="danger"
                              type="submit"
                            >
                              Delete
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

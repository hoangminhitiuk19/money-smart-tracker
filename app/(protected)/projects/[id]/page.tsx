import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProject } from "@/lib/actions/projects";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import ProjectDetailLoading from "./loading";

const statusVariants = {
  ACTIVE: "active",
  COMPLETED: "adjustment",
  PAUSED: "paused"
} as const;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({
  params
}: PageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<ProjectDetailLoading />}>
      <ProjectDetailPageContent id={id} />
    </Suspense>
  );
}

async function ProjectDetailPageContent({
  id
}: {
  id: string;
}) {
  const project = await getProject(id).catch(() => notFound());

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link className="text-sm font-medium text-primary hover:text-indigo-700" href="/projects">
        &larr; Back to projects
      </Link>
      <Card>
        <Badge label={project.status} variant={statusVariants[project.status]} />
        <h1 className="mt-4 text-2xl font-semibold text-slate-950">
          {project.name}
        </h1>
        {project.description ? (
          <p className="mt-3 text-sm text-slate-600">{project.description}</p>
        ) : null}
        <p className="mt-6 text-sm text-slate-600">
          Project detail metrics, transaction drill-down, and richer editing
          will be filled in after transactions exist.
        </p>
      </Card>
    </div>
  );
}

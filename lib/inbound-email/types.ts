export type InboundNotification = {
  eventId: string;
  messageId: string;
  recipients: string[];
  occurredAt: Date;
};

export type InboundMessage = {
  text: string | null;
  html: string | null;
  attachmentCount: number;
};

export interface InboundEmailProvider {
  verifyNotification(rawBody: string, headers: Headers): InboundNotification;
  retrieveMessage(
    messageId: string,
    signal: AbortSignal
  ): Promise<InboundMessage>;
}

export type EmailDraftCandidate = {
  type: "EXPENSE";
  amountText: string;
  currency: string;
  transactionDateText: string;
  title: string;
  description: "Synthetic inbound-email test data.";
  confidence: 100;
};

export type SyntheticParseResult =
  | { kind: "candidate"; candidate: EmailDraftCandidate }
  | { kind: "unsupported"; code: "UNSUPPORTED" };

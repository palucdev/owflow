type Envelope = {
  event: string;
  session?: { sessionID: string };
  context: { tool?: string; args?: { command?: string } };
};

export default async (envelope: Envelope) => {
  const { tool, args } = envelope.context;
  const session = envelope.session?.sessionID ?? "unknown";
  console.log(
    `[example-hook] ${envelope.event} session=${session} tool=${tool ?? "?"} command=${args?.command ?? ""}`,
  );
  return { protocol: "owflow-hooks/1", status: "ok" };
};

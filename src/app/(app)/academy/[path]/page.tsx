import Link from "next/link";
import { notFound } from "next/navigation";
import { PrismaClient } from "@prisma/client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { Band, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { loadPathProgress } from "@/lib/academy";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";

import { completeModuleAction, startPathAction } from "../actions";

const db = new PrismaClient();

const LAB_TARGETS: Record<string, { label: string; href: string }> = {
  agent: { label: "Open an agent", href: "/marketplace" },
  "data-product": { label: "Open a data product", href: "/data-products" },
  "coverage-matrix": { label: "Open a coverage matrix", href: "/agents" },
  audit: { label: "Open the audit trail", href: "/audit" },
  "evidence-pack": { label: "Find an evidence pack", href: "/marketplace" },
};

export default async function AcademyPathPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path: pathKey } = await params;
  const session = await requireSessionContext();

  const organization = await db.organization.findUnique({
    where: { id: session.organizationId },
    select: { industryId: true },
  });

  const progress = await withOrg(session.organizationId, (client) =>
    loadPathProgress(client, {
      organizationId: session.organizationId,
      userId: session.userId,
      packKey: organization?.industryId ?? "_generic",
    }),
  );

  const entry = progress.find((p) => p.path.key === pathKey);
  if (!entry) notFound();

  const { path, packKey } = entry;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/academy" className="text-muted">
          ← Academy
        </Link>
        <PageTitle className="mt-1">{path.title}</PageTitle>
        <Muted className="mt-1 max-w-prose">{path.summary}</Muted>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {entry.credentialHeld ? (
            <Badge tone="success">{path.credentialKey.replace(/-/g, " ")} held</Badge>
          ) : (
            <Badge tone="neutral">
              {entry.completedModules} of {entry.totalModules} modules
            </Badge>
          )}
          {entry.unlocksRoles.length > 0 ? (
            <span className="text-muted">unlocks {entry.unlocksRoles.join(", ")}</span>
          ) : null}
        </div>
      </div>

      {!entry.started ? (
        <Panel>
          <ActionForm action={startPathAction}>
            <input type="hidden" name="pathKey" value={path.key} />
            <input type="hidden" name="packKey" value={packKey} />
            <SubmitButton pendingLabel="Starting…">Start this path</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      {path.courses.map((course) => (
        <div key={course.key} className="space-y-4">
          <div>
            <SectionTitle>{course.title}</SectionTitle>
            <Muted className="mt-1">{course.summary}</Muted>
          </div>

          {course.modules.map((lesson) => {
            const state = entry.modules.find(
              (m) => m.courseKey === course.key && m.moduleKey === lesson.key,
            );
            const lab = lesson.lab ? LAB_TARGETS[lesson.lab.target] : null;

            return (
              <Panel key={lesson.key} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-section-title">{lesson.title}</p>
                  {state?.completed ? <Badge tone="success">complete</Badge> : null}
                </div>

                <p className="max-w-prose">{lesson.body}</p>

                {lesson.lab ? (
                  <Band>
                    <p className="font-medium">Lab · {lesson.lab.title}</p>
                    <p className="mt-1">{lesson.lab.instructions}</p>
                    {lab ? (
                      <Link href={lab.href} className="mt-2 inline-block font-medium">
                        {lab.label} →
                      </Link>
                    ) : null}
                  </Band>
                ) : null}

                {lesson.assessment.length > 0 ? (
                  <ActionForm action={completeModuleAction} className="space-y-4">
                    <input type="hidden" name="pathKey" value={path.key} />
                    <input type="hidden" name="packKey" value={packKey} />
                    <input type="hidden" name="courseKey" value={course.key} />
                    <input type="hidden" name="moduleKey" value={lesson.key} />

                    {lesson.assessment.map((item, index) => (
                      <fieldset key={index}>
                        <legend className="font-medium">{item.question}</legend>
                        <div className="mt-1 space-y-1">
                          {item.options.map((option, optionIndex) => (
                            <label key={optionIndex} className="flex items-start gap-2">
                              <input
                                type="radio"
                                name={`answer.${index}`}
                                value={optionIndex}
                                required
                                className="mt-1"
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                        {state?.completed ? (
                          <p className="mt-1 text-muted">{item.explanation}</p>
                        ) : null}
                      </fieldset>
                    ))}

                    <SubmitButton pendingLabel="Marking…">
                      {state?.completed ? "Re-take the assessment" : "Complete this module"}
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </Panel>
            );
          })}
        </div>
      ))}
    </div>
  );
}

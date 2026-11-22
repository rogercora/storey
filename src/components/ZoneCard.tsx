import Link from "next/link";

export type ZoneState = "done" | "in_progress" | "todo";

const label: Record<ZoneState, string> = { done: "Completed", in_progress: "In progress", todo: "Not started" };
const style: Record<ZoneState, string> = {
  done: "bg-brand text-white",
  in_progress: "bg-volt text-ink",
  todo: "bg-ink/10 text-ink-soft",
};

export function ZoneCard({
  href,
  name,
  description,
  state,
}: {
  href: string;
  name: string;
  description?: string | null;
  state: ZoneState;
}) {
  return (
    <Link href={href} className="card flex items-center justify-between gap-3 border-l-8 border-l-ink active:scale-[0.99]">
      <div>
        <p className="font-display text-2xl uppercase leading-none">{name}</p>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      <span className={`chip shrink-0 ${style[state]}`}>{label[state]}</span>
    </Link>
  );
}


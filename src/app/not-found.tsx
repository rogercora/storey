import Link from "next/link";
import { BrandHeader } from "@/components/Brand";

export default function NotFoundPage() {
  return (
    <div className="min-h-dvh">
      <BrandHeader />
      <main className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="text-5xl text-brand">Page not found</h1>
        <p className="mt-3 text-sm text-ink-soft">We could not find that zone or page.</p>
        <Link href="/" className="btn-accent mt-6">
          Back to Daily Stocktake
        </Link>
      </main>
    </div>
  );
}


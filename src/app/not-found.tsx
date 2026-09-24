import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Seite nicht gefunden</h1>
      <Link href="/" className="text-primary hover:underline">
        Zur Startseite
      </Link>
    </main>
  );
}

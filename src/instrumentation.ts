/**
 * Läuft einmal beim Serverstart (nicht beim Build): Konfiguration früh und verständlich prüfen,
 * statt beim ersten Request mit einem kryptischen Fehler abzubrechen.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("./env");
    env();
  }
}

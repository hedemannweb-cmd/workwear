-- Bereits per Mail gemeldete Mindestbestands-Unterschreitungen (Schutz vor doppelten Mails)
-- CreateTable
CREATE TABLE "LowStockAlert" (
    "articleVariantId" TEXT NOT NULL,
    "free" INTEGER NOT NULL,
    "minStock" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LowStockAlert_pkey" PRIMARY KEY ("articleVariantId")
);

-- AddForeignKey
ALTER TABLE "LowStockAlert" ADD CONSTRAINT "LowStockAlert_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


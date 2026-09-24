-- Handgeschriebene Constraints, die Prisma nicht abbilden kann (KONZEPT.md D).
-- Namenskonvention der CHECKs: <tabelle>_<regel>, wird in src/server/errors.ts ausgewertet.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Lager: Bestand kann nie negativ werden, reserviert nie mehr als physisch vorhanden ───
ALTER TABLE "Inventory"
  ADD CONSTRAINT inventory_physical_nonnegative CHECK ("physicalQuantity" >= 0),
  ADD CONSTRAINT inventory_reserved_nonnegative CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT inventory_reserved_le_physical CHECK ("reservedQuantity" <= "physicalQuantity"),
  ADD CONSTRAINT inventory_minstock_nonnegative CHECK ("minStock" IS NULL OR "minStock" >= 0);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT movement_has_effect CHECK ("quantityDelta" <> 0 OR "reservedDelta" <> 0),
  ADD CONSTRAINT movement_after_nonnegative CHECK ("physicalAfter" >= 0 AND "reservedAfter" >= 0);

CREATE UNIQUE INDEX "InventoryLocation_single_default" ON "InventoryLocation" ("isDefault") WHERE "isDefault";

-- ─── Mengen ───
ALTER TABLE "ClothingIssueItem"
  ADD CONSTRAINT issue_item_quantity_positive CHECK ("quantity" > 0),
  ADD CONSTRAINT issue_item_quota_year_range CHECK ("quotaYear" BETWEEN 2000 AND 2100),
  ADD CONSTRAINT issue_item_unit_cost_nonnegative CHECK ("unitCost" IS NULL OR "unitCost" >= 0);

ALTER TABLE "ClothingIssue"
  ADD CONSTRAINT issue_cancel_consistent CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)
    OR ("status" = 'COMPLETED' AND "cancelledAt" IS NULL));

ALTER TABLE "ClothingReturnItem"
  ADD CONSTRAINT return_item_quantity_positive CHECK ("quantity" > 0),
  ADD CONSTRAINT return_item_credit_range CHECK ("quotaCreditQuantity" >= 0 AND "quotaCreditQuantity" <= "quantity");

ALTER TABLE "EmployeeReservation"
  ADD CONSTRAINT reservation_quantity_positive CHECK ("quantity" > 0),
  ADD CONSTRAINT reservation_quota_year_range CHECK ("quotaYear" BETWEEN 2000 AND 2100);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT order_item_quantity_positive CHECK ("quantityOrdered" > 0),
  ADD CONSTRAINT order_item_received_nonnegative CHECK ("quantityReceived" >= 0),
  ADD CONSTRAINT order_item_price_nonnegative CHECK ("unitPrice" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT order_dates_consistent CHECK ("expectedDeliveryDate" IS NULL OR "orderDate" IS NULL OR "expectedDeliveryDate" >= "orderDate");

ALTER TABLE "GoodsReceiptItem"
  ADD CONSTRAINT receipt_item_quantity_positive CHECK ("quantity" > 0);

-- ─── Kontingente ───
ALTER TABLE "QuotaRule"
  ADD CONSTRAINT quota_rule_quantity_nonnegative CHECK ("quantityPerYear" >= 0),
  ADD CONSTRAINT quota_rule_years_consistent CHECK ("validToYear" IS NULL OR "validToYear" >= "validFromYear");

ALTER TABLE "EmployeeQuotaAdjustment"
  ADD CONSTRAINT adjustment_delta_nonzero CHECK ("quantityDelta" <> 0),
  ADD CONSTRAINT adjustment_reason_required CHECK (length(btrim("reason")) >= 5);

-- ─── Stammdaten ───
ALTER TABLE "Employee"
  ADD CONSTRAINT employee_exit_after_entry CHECK ("exitDate" IS NULL OR "exitDate" >= "entryDate");

ALTER TABLE "ArticleSupplier"
  ADD CONSTRAINT article_supplier_price_nonnegative CHECK ("purchasePrice" IS NULL OR "purchasePrice" >= 0),
  ADD CONSTRAINT article_supplier_leadtime_nonnegative CHECK ("leadTimeDays" IS NULL OR "leadTimeDays" >= 0);
CREATE UNIQUE INDEX "ArticleSupplier_single_preferred" ON "ArticleSupplier" ("articleId") WHERE "isPreferred";

ALTER TABLE "ArticleVariant"
  ADD CONSTRAINT variant_minstock_nonnegative CHECK ("minStock" IS NULL OR "minStock" >= 0);
CREATE UNIQUE INDEX "ArticleVariant_article_size_color_key" ON "ArticleVariant" ("articleId", "sizeId", "color") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "ArticleVariant_barcode_key" ON "ArticleVariant" ("barcode") WHERE "barcode" IS NOT NULL;

CREATE UNIQUE INDEX "EmployeeSize_employee_scale_category_key" ON "EmployeeSize" ("employeeId", "sizeScaleId", "categoryId") NULLS NOT DISTINCT;

-- Abteilungshistorie: keine überlappenden Zeiträume je Mitarbeiter ([validFrom, validTo) halboffen)
ALTER TABLE "EmployeeDepartmentHistory"
  ADD CONSTRAINT department_history_valid_range CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
  ADD CONSTRAINT department_history_no_overlap EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("validFrom", "validTo", '[)') WITH &&
  );

-- ─── Belegnummern ───
CREATE SEQUENCE issue_number_seq;
CREATE SEQUENCE return_number_seq;
CREATE SEQUENCE order_number_seq;
CREATE SEQUENCE receipt_number_seq;

-- ─── Fehlertolerante Suche (Trigramme) ───
CREATE INDEX "Employee_lastName_trgm" ON "Employee" USING gin ("lastName" gin_trgm_ops);
CREATE INDEX "Employee_firstName_trgm" ON "Employee" USING gin ("firstName" gin_trgm_ops);
CREATE INDEX "Employee_employeeNumber_trgm" ON "Employee" USING gin ("employeeNumber" gin_trgm_ops);
CREATE INDEX "Article_name_trgm" ON "Article" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Article_sku_trgm" ON "Article" USING gin ("sku" gin_trgm_ops);
CREATE INDEX "ArticleVariant_variantSku_trgm" ON "ArticleVariant" USING gin ("variantSku" gin_trgm_ops);
CREATE INDEX "Order_orderNumber_trgm" ON "Order" USING gin ("orderNumber" gin_trgm_ops);

-- ─── Unveränderliche Journale: Audit Log und Lagerbewegungen ───
CREATE FUNCTION forbid_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % ist unveränderlich (nur INSERT erlaubt)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "AuditLog_immutable" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "InventoryMovement_immutable" BEFORE UPDATE OR DELETE ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

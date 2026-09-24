-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'RESPONSIBLE');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "EntryRule" AS ENUM ('FULL', 'PRORATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AdjustmentSource" AS ENUM ('MANUAL', 'OVERRIDE', 'IMPORT');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('RETURN_TO_STOCK', 'EXCHANGE', 'DEFECTIVE', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('STORAGE', 'DEFECTIVE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'ISSUE_CANCELLATION', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'INVENTORY_COUNT', 'RESERVE', 'UNRESERVE');

-- CreateEnum
CREATE TYPE "MovementReference" AS ENUM ('CLOTHING_ISSUE', 'CLOTHING_RETURN', 'GOODS_RECEIPT', 'RESERVATION', 'INVENTORY_ADJUSTMENT', 'TRANSFER', 'IMPORT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'ORDERED', 'RECEIVED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'RESPONSIBLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "restrictedToDepartments" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDepartmentScope" (
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "UserDepartmentScope_pkey" PRIMARY KEY ("userId","departmentId")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quotaProfileId" TEXT,
    "costCenter" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "exitDate" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "pseudonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDepartmentHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDepartmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSize" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sizeScaleId" TEXT NOT NULL,
    "categoryId" TEXT,
    "sizeId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeScale" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SizeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Size" (
    "id" TEXT NOT NULL,
    "sizeScaleId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Size_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeScaleId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ClothingCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isQuotaRelevant" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QuotaGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "quotaGroupId" TEXT NOT NULL,
    "manufacturer" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isStockItem" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleVariant" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "sizeId" TEXT,
    "color" TEXT,
    "barcode" TEXT,
    "minStock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ArticleVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "supplierNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSupplier" (
    "articleId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSku" TEXT,
    "purchasePrice" DECIMAL(12,2),
    "leadTimeDays" INTEGER,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ArticleSupplier_pkey" PRIMARY KEY ("articleId","supplierId")
);

-- CreateTable
CREATE TABLE "QuotaProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entryRule" "EntryRule",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaRule" (
    "id" TEXT NOT NULL,
    "quotaProfileId" TEXT NOT NULL,
    "quotaGroupId" TEXT NOT NULL,
    "validFromYear" INTEGER NOT NULL,
    "validToYear" INTEGER,
    "quantityPerYear" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeQuotaAdjustment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quotaGroupId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" "AdjustmentSource" NOT NULL DEFAULT 'MANUAL',
    "relatedIssueId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeQuotaAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaYearLock" (
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "QuotaYearLock_pkey" PRIMARY KEY ("employeeId","year")
);

-- CreateTable
CREATE TABLE "ClothingIssue" (
    "id" TEXT NOT NULL,
    "issueNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentIdSnapshot" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'COMPLETED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ClothingIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingIssueItem" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "articleVariantId" TEXT NOT NULL,
    "inventoryLocationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quotaGroupId" TEXT NOT NULL,
    "quotaYear" INTEGER NOT NULL,
    "quotaRelevant" BOOLEAN NOT NULL,
    "unitCost" DECIMAL(12,2),
    "reservationId" TEXT,
    "exchangeOfReturnItemId" TEXT,

    CONSTRAINT "ClothingIssueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingReturn" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ClothingReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "issueItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returnType" "ReturnType" NOT NULL,
    "quotaCreditQuantity" INTEGER NOT NULL,
    "inventoryLocationId" TEXT,
    "reason" TEXT,

    CONSTRAINT "ClothingReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'STORAGE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "articleVariantId" TEXT NOT NULL,
    "inventoryLocationId" TEXT NOT NULL,
    "physicalQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "articleVariantId" TEXT NOT NULL,
    "inventoryLocationId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "physicalAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "referenceType" "MovementReference" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "transferGroupId" TEXT,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeReservation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "articleVariantId" TEXT NOT NULL,
    "quotaGroupId" TEXT NOT NULL,
    "quotaYear" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "orderItemId" TEXT,
    "inventoryLocationId" TEXT,
    "splitFromId" TEXT,
    "clientRequestId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "EmployeeReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderDate" DATE,
    "expectedDeliveryDate" DATE,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "articleVariantId" TEXT NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "supplierId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "deliveryNoteNumber" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "articleVariantId" TEXT NOT NULL,
    "inventoryLocationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "UserDepartmentScope_departmentId_idx" ON "UserDepartmentScope"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "Department_quotaProfileId_idx" ON "Department"("quotaProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE INDEX "Employee_lastName_firstName_idx" ON "Employee"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "EmployeeDepartmentHistory_employeeId_validFrom_idx" ON "EmployeeDepartmentHistory"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "EmployeeDepartmentHistory_departmentId_idx" ON "EmployeeDepartmentHistory"("departmentId");

-- CreateIndex
CREATE INDEX "EmployeeSize_employeeId_idx" ON "EmployeeSize"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SizeScale_code_key" ON "SizeScale"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Size_sizeScaleId_value_key" ON "Size"("sizeScaleId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingCategory_name_key" ON "ClothingCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaGroup_code_key" ON "QuotaGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Article_sku_key" ON "Article"("sku");

-- CreateIndex
CREATE INDEX "Article_categoryId_idx" ON "Article"("categoryId");

-- CreateIndex
CREATE INDEX "Article_quotaGroupId_idx" ON "Article"("quotaGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleVariant_variantSku_key" ON "ArticleVariant"("variantSku");

-- CreateIndex
CREATE INDEX "ArticleVariant_articleId_idx" ON "ArticleVariant"("articleId");

-- CreateIndex
CREATE INDEX "ArticleVariant_barcode_idx" ON "ArticleVariant"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierNumber_key" ON "Supplier"("supplierNumber");

-- CreateIndex
CREATE INDEX "ArticleSupplier_supplierId_idx" ON "ArticleSupplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaProfile_code_key" ON "QuotaProfile"("code");

-- CreateIndex
CREATE INDEX "QuotaRule_quotaGroupId_idx" ON "QuotaRule"("quotaGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaRule_quotaProfileId_quotaGroupId_validFromYear_key" ON "QuotaRule"("quotaProfileId", "quotaGroupId", "validFromYear");

-- CreateIndex
CREATE INDEX "EmployeeQuotaAdjustment_employeeId_year_idx" ON "EmployeeQuotaAdjustment"("employeeId", "year");

-- CreateIndex
CREATE INDEX "EmployeeQuotaAdjustment_quotaGroupId_idx" ON "EmployeeQuotaAdjustment"("quotaGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingIssue_issueNumber_key" ON "ClothingIssue"("issueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingIssue_clientRequestId_key" ON "ClothingIssue"("clientRequestId");

-- CreateIndex
CREATE INDEX "ClothingIssue_employeeId_issuedAt_idx" ON "ClothingIssue"("employeeId", "issuedAt");

-- CreateIndex
CREATE INDEX "ClothingIssue_issuedAt_idx" ON "ClothingIssue"("issuedAt");

-- CreateIndex
CREATE INDEX "ClothingIssue_status_idx" ON "ClothingIssue"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingIssueItem_reservationId_key" ON "ClothingIssueItem"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingIssueItem_exchangeOfReturnItemId_key" ON "ClothingIssueItem"("exchangeOfReturnItemId");

-- CreateIndex
CREATE INDEX "ClothingIssueItem_issueId_idx" ON "ClothingIssueItem"("issueId");

-- CreateIndex
CREATE INDEX "ClothingIssueItem_quotaGroupId_quotaYear_idx" ON "ClothingIssueItem"("quotaGroupId", "quotaYear");

-- CreateIndex
CREATE INDEX "ClothingIssueItem_articleVariantId_idx" ON "ClothingIssueItem"("articleVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingReturn_returnNumber_key" ON "ClothingReturn"("returnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingReturn_clientRequestId_key" ON "ClothingReturn"("clientRequestId");

-- CreateIndex
CREATE INDEX "ClothingReturn_employeeId_returnedAt_idx" ON "ClothingReturn"("employeeId", "returnedAt");

-- CreateIndex
CREATE INDEX "ClothingReturnItem_returnId_idx" ON "ClothingReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "ClothingReturnItem_issueItemId_idx" ON "ClothingReturnItem"("issueItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_code_key" ON "InventoryLocation"("code");

-- CreateIndex
CREATE INDEX "Inventory_inventoryLocationId_idx" ON "Inventory"("inventoryLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_articleVariantId_inventoryLocationId_key" ON "Inventory"("articleVariantId", "inventoryLocationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_articleVariantId_createdAt_idx" ON "InventoryMovement"("articleVariantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryLocationId_idx" ON "InventoryMovement"("inventoryLocationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceType_referenceId_idx" ON "InventoryMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeReservation_clientRequestId_key" ON "EmployeeReservation"("clientRequestId");

-- CreateIndex
CREATE INDEX "EmployeeReservation_employeeId_quotaYear_status_idx" ON "EmployeeReservation"("employeeId", "quotaYear", "status");

-- CreateIndex
CREATE INDEX "EmployeeReservation_status_idx" ON "EmployeeReservation"("status");

-- CreateIndex
CREATE INDEX "EmployeeReservation_orderItemId_idx" ON "EmployeeReservation"("orderItemId");

-- CreateIndex
CREATE INDEX "EmployeeReservation_articleVariantId_idx" ON "EmployeeReservation"("articleVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_supplierId_idx" ON "Order"("supplierId");

-- CreateIndex
CREATE INDEX "Order_expectedDeliveryDate_idx" ON "Order"("expectedDeliveryDate");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_articleVariantId_idx" ON "OrderItem"("articleVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_articleVariantId_key" ON "OrderItem"("orderId", "articleVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_receiptNumber_key" ON "GoodsReceipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_clientRequestId_key" ON "GoodsReceipt"("clientRequestId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_orderId_idx" ON "GoodsReceipt"("orderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_receivedAt_idx" ON "GoodsReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_goodsReceiptId_idx" ON "GoodsReceiptItem"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_orderItemId_idx" ON "GoodsReceiptItem"("orderItemId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentScope" ADD CONSTRAINT "UserDepartmentScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentScope" ADD CONSTRAINT "UserDepartmentScope_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_quotaProfileId_fkey" FOREIGN KEY ("quotaProfileId") REFERENCES "QuotaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDepartmentHistory" ADD CONSTRAINT "EmployeeDepartmentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDepartmentHistory" ADD CONSTRAINT "EmployeeDepartmentHistory_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDepartmentHistory" ADD CONSTRAINT "EmployeeDepartmentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSize" ADD CONSTRAINT "EmployeeSize_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSize" ADD CONSTRAINT "EmployeeSize_sizeScaleId_fkey" FOREIGN KEY ("sizeScaleId") REFERENCES "SizeScale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSize" ADD CONSTRAINT "EmployeeSize_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ClothingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSize" ADD CONSTRAINT "EmployeeSize_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Size" ADD CONSTRAINT "Size_sizeScaleId_fkey" FOREIGN KEY ("sizeScaleId") REFERENCES "SizeScale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingCategory" ADD CONSTRAINT "ClothingCategory_sizeScaleId_fkey" FOREIGN KEY ("sizeScaleId") REFERENCES "SizeScale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ClothingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_quotaGroupId_fkey" FOREIGN KEY ("quotaGroupId") REFERENCES "QuotaGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleVariant" ADD CONSTRAINT "ArticleVariant_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleVariant" ADD CONSTRAINT "ArticleVariant_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSupplier" ADD CONSTRAINT "ArticleSupplier_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSupplier" ADD CONSTRAINT "ArticleSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaRule" ADD CONSTRAINT "QuotaRule_quotaProfileId_fkey" FOREIGN KEY ("quotaProfileId") REFERENCES "QuotaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaRule" ADD CONSTRAINT "QuotaRule_quotaGroupId_fkey" FOREIGN KEY ("quotaGroupId") REFERENCES "QuotaGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaRule" ADD CONSTRAINT "QuotaRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQuotaAdjustment" ADD CONSTRAINT "EmployeeQuotaAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQuotaAdjustment" ADD CONSTRAINT "EmployeeQuotaAdjustment_quotaGroupId_fkey" FOREIGN KEY ("quotaGroupId") REFERENCES "QuotaGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQuotaAdjustment" ADD CONSTRAINT "EmployeeQuotaAdjustment_relatedIssueId_fkey" FOREIGN KEY ("relatedIssueId") REFERENCES "ClothingIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQuotaAdjustment" ADD CONSTRAINT "EmployeeQuotaAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaYearLock" ADD CONSTRAINT "QuotaYearLock_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssue" ADD CONSTRAINT "ClothingIssue_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssue" ADD CONSTRAINT "ClothingIssue_departmentIdSnapshot_fkey" FOREIGN KEY ("departmentIdSnapshot") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssue" ADD CONSTRAINT "ClothingIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssue" ADD CONSTRAINT "ClothingIssue_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssueItem" ADD CONSTRAINT "ClothingIssueItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ClothingIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssueItem" ADD CONSTRAINT "ClothingIssueItem_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssueItem" ADD CONSTRAINT "ClothingIssueItem_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssueItem" ADD CONSTRAINT "ClothingIssueItem_quotaGroupId_fkey" FOREIGN KEY ("quotaGroupId") REFERENCES "QuotaGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssueItem" ADD CONSTRAINT "ClothingIssueItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "EmployeeReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingIssueItem" ADD CONSTRAINT "ClothingIssueItem_exchangeOfReturnItemId_fkey" FOREIGN KEY ("exchangeOfReturnItemId") REFERENCES "ClothingReturnItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingReturn" ADD CONSTRAINT "ClothingReturn_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingReturn" ADD CONSTRAINT "ClothingReturn_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingReturnItem" ADD CONSTRAINT "ClothingReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ClothingReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingReturnItem" ADD CONSTRAINT "ClothingReturnItem_issueItemId_fkey" FOREIGN KEY ("issueItemId") REFERENCES "ClothingIssueItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingReturnItem" ADD CONSTRAINT "ClothingReturnItem_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_quotaGroupId_fkey" FOREIGN KEY ("quotaGroupId") REFERENCES "QuotaGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "EmployeeReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeReservation" ADD CONSTRAINT "EmployeeReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_articleVariantId_fkey" FOREIGN KEY ("articleVariantId") REFERENCES "ArticleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

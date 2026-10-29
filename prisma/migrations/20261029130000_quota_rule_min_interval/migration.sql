-- Rollierender Mindestabstand zwischen zwei Ausgaben einer Kontingentgruppe (z. B. Winterjacke alle 24 Monate)
ALTER TABLE "QuotaRule" ADD COLUMN "minIntervalMonths" INTEGER;

ALTER TABLE "QuotaRule"
  ADD CONSTRAINT quota_rule_min_interval_positive CHECK ("minIntervalMonths" IS NULL OR "minIntervalMonths" > 0);

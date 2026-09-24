# Arbeitskleidungsverwaltung: Konzept und Architektur (Entwurf v1)

> Status: **zur Freigabe**. Es gibt noch keinen Anwendungscode.
> Die mit **BDR-x** markierten Punkte sind *Business Decisions Required* und blockieren die zugehörigen Module.

---

## A. Anforderungsanalyse

### A.1 Worum es fachlich geht
Das System verwaltet vier eng verzahnte Buchführungen:

| Buchführung | Frage, die sie beantwortet | Wahrheit liegt in |
|---|---|---|
| **Kontingent** | Was darf Mitarbeiter X im Jahr Y noch bekommen? | Regeln + Anpassungen + Ausgaben + Rückgaben + aktive Reservierungen |
| **Lager** | Wie viel physische Ware liegt wo, und wie viel davon ist schon jemandem zugesagt? | `InventoryMovement` (Journal); `Inventory` ist nur eine konsistente Projektion |
| **Beschaffung** | Was ist bei wem bestellt, was ist eingetroffen, für wen ist es? | Order → OrderItem → EmployeeReservation, GoodsReceipt |
| **Audit** | Wer hat wann was warum geändert? | AuditLog (nur anhängen, nie ändern) |

Alle vier müssen **in derselben DB-Transaktion** fortgeschrieben werden, sobald ein Domänenprozess sie gemeinsam berührt (z. B. Ausgabe = Kontingent + Lager + Audit).

### A.2 Kernprinzipien, die daraus folgen
1. **Journal statt Zähler.** Verfügbares Kontingent wird nie gespeichert, sondern immer berechnet. Der Lagerbestand wird aus Performancegründen als Zahl geführt, ändert sich aber *ausschließlich* zusammen mit einer Lagerbewegung in derselben Transaktion. Ein Konsistenzcheck vergleicht beides.
2. **Transaktionen werden nie gelöscht.** Korrekturen passieren durch Storno- bzw. Gegenbuchungen mit Begründung.
3. **Snapshots an Transaktionen.** Eine Ausgabe speichert Variante, Lagerort, Abteilung zum Zeitpunkt, Kontingentjahr und Stückkosten. Spätere Änderungen an Stammdaten verändern die Historie nicht.
4. **Domänenprozesse statt CRUD.** `issueClothing()`, `reserveClothing()` usw. sind die einzigen Schreibwege für Bewegungsdaten. UI und Server Actions rufen nur diese Funktionen auf.
5. **Autorisierung serverseitig, in jedem Prozess.** Das Prüfen einer Rolle *und* des Abteilungs-Scopes ist Teil jedes Domänenaufrufs.

### A.3 Befunde bei der Prüfung der Vorgaben
- **Lücke im MVP-Zuschnitt:** Phase 1 enthält *Reservierung* und *einfache Bestellung*, der *Wareneingang* kommt aber erst in Phase 2. Damit könnten bestellte Reservierungen im MVP nie erfüllt werden. **Vorschlag:** ein *einfacher Wareneingang* (vollständige Lieferung einer Bestellposition, direkt ausgeben oder einlagern) kommt in Phase 1. Teillieferungen und Sammelbestellungen bleiben in Phase 2.
- **Kontingentbezug unklar:** Die Beispiele sprechen von „T-Shirt = 5“, die Rückgabe von `getEmployeeQuota` enthält aber `articleId`. Ob sich ein Kontingent auf einen konkreten Artikel oder auf eine Artikelgruppe bezieht, ist die wichtigste offene Fachfrage (→ **BDR-1**).
- **„Role“ als Tabelle:** Bei drei festen Rollen, deren Rechte im Code geprüft werden, bringt eine Rollentabelle nur Scheinflexibilität. Vorschlag: `enum Role` am User und eine Berechtigungsmatrix im Code (siehe H). Die Abteilungsbeschränkung liegt in `UserDepartmentScope`.
- **Lagerreservierung ≠ Kontingentreservierung.** `Inventory.reservedQuantity` meint physisch vorhandene Ware, die schon einem Mitarbeiter zugesagt ist. `EmployeeReservation` meint einen Kontingentanspruch, für den oft noch keine Ware existiert. Beides wird sauber getrennt.
- **Umtausch über den Jahreswechsel:** Im Dezember ausgegeben, im Januar umgetauscht. Das Kontingentjahr muss deshalb **explizit an jeder Position gespeichert** werden (`quotaYear`) und darf nicht aus dem Datum abgeleitet werden. Sonst wird das neue Jahr belastet.

### A.4 Kritische Edge Cases
| # | Fall | Behandlung |
|---|---|---|
| E1 | Zwei Benutzer geben gleichzeitig das letzte Kontingent aus | Pessimistische Sperre auf die Zeile Mitarbeiter × Jahr (siehe E.4) |
| E2 | Zwei Benutzer greifen gleichzeitig auf das letzte Lagerstück zu | Bedingtes atomares `UPDATE … WHERE physical - reserved >= n` plus CHECK-Constraint |
| E3 | Reservierung wird storniert, nachdem die Ware schon bestellt ist | Kontingent wird frei. Die Bestellposition bleibt und wird zur Lagerware (siehe G.5) |
| E4 | Teillieferung deckt nur einen Teil der Reservierungen | FIFO-Zuteilung nach Reservierungsdatum; die Reservierung wird bei Bedarf gesplittet |
| E5 | Abteilungswechsel mitten im Jahr | → **BDR-3** |
| E6 | Eintritt mitten im Jahr | → **BDR-4** (FULL / PRORATED / MANUAL) |
| E7 | Austritt mitten im Jahr, offene Reservierungen | Austritt storniert offene Reservierungen nicht automatisch, zeigt sie aber als Handlungsbedarf. Nach `exitDate` sind keine Ausgaben mehr möglich |
| E8 | Umtausch über den Jahreswechsel | Neue Ausgabe erbt `quotaYear` der Originalposition |
| E9 | Artikel wird deaktiviert, obwohl Reservierungen offen sind | Deaktivierung verhindert neue Vorgänge; offene werden weiter abgewickelt |
| E10 | Kontingentregel für ein laufendes Jahr wird geändert | Regeln sind versioniert (`validFromYear`). Änderungen im laufenden Jahr nur durch ADMIN mit Begründung und Audit |
| E11 | Admin will über Kontingent hinaus ausgeben | → **BDR-6** |
| E12 | Inventurdifferenz erzeugt einen negativen Bestand | Nicht möglich. Die Inventur setzt den Zählwert, die Differenz wird als `INVENTORY_COUNT`-Bewegung gebucht. Liegt `reserved` dann über `physical`, entsteht ein Handlungsbedarf |
| E13 | Mitarbeiter hat für eine Kategorie keine Größe hinterlegt | Ausgabe bleibt möglich (Variante wird explizit gewählt); erscheint im Datenqualitäts-Dashboard |
| E14 | Doppelklick oder erneutes Senden desselben Formulars | Idempotenzschlüssel (`clientRequestId`, UNIQUE) an Issue, Reservation und Order |
| E15 | Lieferant liefert mehr als bestellt | Überlieferung braucht eine explizite Bestätigung und geht als Lagerware ein |
| E16 | Retoure an den Lieferanten | Nicht im MVP. Das Modell lässt sich über den Bewegungstyp `SUPPLIER_RETURN` erweitern |

---

## B. BUSINESS DECISIONS REQUIRED

Jede Entscheidung hat eine Empfehlung. Wenn du „Empfehlungen übernehmen“ sagst, setze ich genau diese um.

### BDR-1: Worauf bezieht sich ein Kontingent?
**Problem:** Mit „5 T-Shirts“ kann „5 Stück von Artikel TS-001“ gemeint sein oder „5 Stück aus der Gruppe T-Shirts“ (egal welches Modell oder welcher Lieferant).
- **Option A: Artikel.** Einfach. Wechselt aber das T-Shirt-Modell, müssen alle Kontingentprofile angepasst werden, und die Jahresberechnung zerbricht, wenn im Jahr zwei Modelle ausgegeben werden.
- **Option B: Kontingentgruppe (`QuotaGroup`).** Jeder Artikel gehört zu genau einer Gruppe, z. B. „T-Shirt“, „Hose“, „Jacke“. Kontingentregeln beziehen sich auf die Gruppe.
- **Empfehlung: B.** Die Gruppe ist fachlich *das, was der Mitarbeiter bekommen darf*; der Artikel ist *womit es erfüllt wird*. Die Gruppe ist bewusst von `ClothingCategory` getrennt, weil eine Kategorie („Oberteile“) mehrere Kontingentgruppen umfassen kann. Im einfachsten Fall legt man sie 1:1 an.
- **Auswirkung:** `getEmployeeQuota` liefert `quotaGroupId` und `quotaGroupName` statt `articleId`. Winter- und Arbeitsjacke können so getrennte Gruppen sein oder sich eine Gruppe teilen, je nach Wunsch.

### BDR-2: Artikel ohne Kontingent
**Problem:** Gibt es Artikel, die ohne Kontingent ausgegeben werden (z. B. Sicherheitsschuhe nach Bedarf oder Handschuhe)?
- **A:** Jeder Artikel ist kontingentpflichtig. **B:** Ein Flag `QuotaGroup.isQuotaRelevant = false` erlaubt die freie Ausgabe mit Protokoll.
- **Empfehlung: B**, damit Verbrauchsartikel später ohne Umbau hinzukommen können.

### BDR-3: Abteilungswechsel im laufenden Jahr
**Problem:** Mitarbeiter wechselt am 01.07. von Produktion (5 T-Shirts) ins Lager (6 T-Shirts).
- **A: Stichtag.** Für das Jahr gilt das Profil der Abteilung am Stichtag (bei laufendem Jahr: heute; bei vergangenem Jahr: 31.12.). Bereits Ausgegebenes zählt weiter.
- **B: Anteilig.** 6/12 × 5 + 6/12 × 6.
- **C: Maximum** beider Profile.
- **Empfehlung: A** plus die Möglichkeit individueller Anpassungen. Der Anspruch kann dadurch sinken; hat der Mitarbeiter bereits mehr erhalten, wird `available` als 0 angezeigt und als „überschritten“ markiert, es wird aber nichts zurückgefordert.
- **Auswirkung:** Historische Ausgaben bleiben unverändert, weil sie `departmentId` als Snapshot speichern.

### BDR-4: Unterjähriger Eintritt (Einstellung FULL / PRORATED / MANUAL)
Bei **PRORATED** muss die Formel festgelegt werden. Vorschlag:
```
Monate      = 12 − Eintrittsmonat + 1        (Eintritt 15.04. → 9 Monate; der Eintrittsmonat zählt voll)
Anspruch    = round_half_up(Basis × Monate / 12)
Mindestwert = 1, wenn Basis ≥ 1               (sonst: Jacke 1 × 3/12 = 0,25 → 0)
```
Beispiele: Basis 5, Eintritt 15.04. → 5 × 9/12 = 3,75 → **4**. Basis 1, Eintritt 01.11. → 0,17 → 0 → Mindestwert **1**.
- **Offene Teilfragen:** (a) Zählt der Eintrittsmonat voll? (b) Gibt es den Mindestwert 1? (c) Gilt die Regel auch bei einem Austritt im laufenden Jahr? Empfehlung: nein, beim Austritt wird nicht gekürzt.
- **MANUAL:** Der Anspruch im Eintrittsjahr ist 0, bis ein Admin eine Anpassung erfasst. Die Mitarbeiterseite zeigt dafür einen Hinweis.
- **Empfehlung:** Standard **PRORATED** mit der Formel oben. Einstellbar global mit Ausnahme pro Profil.

### BDR-5: Rückgabearten und Kontingentwirkung
| Rückgabeart | Lagerwirkung | Kontingentwirkung (Empfehlung) |
|---|---|---|
| `RETURN_TO_STOCK` (ungetragen und wiederverkaufsfähig) | +Bestand | **Gutschrift** |
| `EXCHANGE` (Größentausch) | +Bestand alt, −Bestand neu | **neutral**: Gutschrift und Neubelastung im selben Kontingentjahr |
| `DEFECTIVE` (Produktionsfehler, Ersatz) | kein Zugang (Ausschusslager oder Abschreibung) | **Gutschrift**, der Mitarbeiter soll für den Mangel nicht bezahlen |
| `WRITE_OFF` (verschlissen, verloren, Rücknahme Altkleidung) | kein Zugang | **keine Gutschrift** |

**Frage:** Darf getragene Kleidung überhaupt ins Lager zurück (Hygiene)? Empfehlung: nein. `RETURN_TO_STOCK` nur für ungetragene Ware, als Pflicht-Checkbox im Dialog.

### BDR-6: Ausgabe über das Kontingent hinaus (Admin-Sonderfreigabe)
- **A:** Nie möglich; zuerst muss eine Anpassung angelegt werden.
- **B:** Admin kann „trotzdem ausgeben“. Das System legt dann in derselben Transaktion automatisch eine `EmployeeQuotaAdjustment` (+n, Pflichtbegründung) an und bucht danach die Ausgabe.
- **Empfehlung: B.** Die Rechnung bleibt lückenlos (Basis + Anpassung − Ausgabe ≥ 0), der Vorgang ist ein Schritt, und die Sonderfreigabe ist als eigene Anpassung auswertbar. Dürfen auch MANAGER das? Empfehlung: ja, RESPONSIBLE nicht.

### BDR-7: Welches Kontingentjahr belastet eine Ausgabe?
- **A:** Immer das Kalenderjahr des Ausgabedatums.
- **B:** Wählbar, z. B. für Vorgriff auf das nächste Jahr im Dezember.
- **Empfehlung: A** als Standard. Vorgriff nur durch ADMIN mit Begründung. Reservierungen und Umtausch behalten ihr ursprüngliches Jahr: im Dezember 2026 bestellt und im Januar 2027 ausgegeben heißt Belastung 2026.

### BDR-8: Stornierung einer Ausgabe
Wer darf eine fehlerhafte Buchung stornieren, und bis wann?
- **Empfehlung:** RESPONSIBLE am selben Tag bei eigenen Buchungen; MANAGER und ADMIN jederzeit. Immer mit Begründung, als Gegenbuchung ohne Löschung.

### BDR-9: Kostenbewertung
**Problem:** Welcher Preis gilt für Kostenauswertungen je Ausgabe?
- **A:** Preis des Vorzugslieferanten zum Ausgabezeitpunkt (Snapshot). **B:** gleitender Durchschnitt aus Wareneingängen. **C:** FIFO-Bewertung.
- **Empfehlung:** Im MVP **A** (einfach, nachvollziehbar), ab Phase 2 **B**. Der Snapshot `unitCost` an der Ausgabeposition bleibt in beiden Fällen, damit Auswertungen stabil bleiben.

### BDR-10: Anmeldung
- **A:** Eigene Benutzer mit E-Mail und Passwort. **B:** Microsoft Entra ID / Google Workspace (SSO).
- **Empfehlung:** Im MVP **A**; die gewählte Auth-Lösung unterstützt SSO später ohne Datenmodell-Umbau. Gibt es bereits Microsoft 365? Dann B früh einplanen.
- Mitarbeiter selbst melden sich **nicht** an (kein Self-Service). Bitte bestätigen.

### BDR-11: Scope von RESPONSIBLE
- Sieht ein auf Abteilungen beschränkter RESPONSIBLE Mitarbeiter anderer Abteilungen gar nicht, oder nur lesend?
- **Empfehlung:** gar nicht (Datenminimierung). Den Lagerbestand sieht er vollständig.

### BDR-12: Bestellungen ohne Mitarbeiterbezug
Darf RESPONSIBLE reine Lagerbestellungen anlegen, oder nur MANAGER und ADMIN? **Empfehlung:** nur MANAGER und ADMIN. RESPONSIBLE erzeugt nur Mitarbeiterreservierungen, also Bedarf.

---

## C. Domänenmodell

```
            ┌──────────── Stammdaten (deaktivierbar, nie löschen) ────────────┐
            │ Department  QuotaGroup  ClothingCategory  Article  ArticleVariant│
            │ SizeScale   Size        Supplier          InventoryLocation      │
            └──────────────────────────────────────────────────────────────────┘
Employee ──< EmployeeDepartmentHistory >── Department ──> QuotaProfile ──< QuotaRule >── QuotaGroup
   │                                                                                       ▲
   ├──< EmployeeSize (je SizeScale oder Kategorie)                                         │
   ├──< EmployeeQuotaAdjustment ───────────────────────────────────────────────────────────┤
   ├──< ClothingIssue ──< ClothingIssueItem ──> ArticleVariant ──> Article ──> QuotaGroup ─┘
   │                          ▲
   │     ClothingReturn ──< ClothingReturnItem (verweist auf IssueItem)
   └──< EmployeeReservation >── OrderItem >── Order >── Supplier
                                   ▲
              GoodsReceipt ──< GoodsReceiptItem

Inventory (Variant × Location) ◄── projiziert aus ── InventoryMovement (Journal)
AuditLog  ◄── jeder Domänenprozess
```

**Aggregate und Konsistenzgrenzen**
- **Mitarbeiter-Kontingentjahr** (Employee × Jahr): Alles, was das Kontingent verändert, sperrt diese Grenze (Issue, Reservation, Return, Adjustment).
- **Lagerposition** (Variant × Location): Alles, was Bestand verändert, sperrt diese Zeile.
- **Bestellung**: Status und Positionen; der Wareneingang sperrt die Bestellung.

**Domänenprozesse (die einzigen Schreibwege)**

| Prozess | Sperrt | Schreibt |
|---|---|---|
| `issueClothing` | Kontingentjahr, Lagerposition(en) | ClothingIssue(+Items), InventoryMovement ISSUE, Inventory, AuditLog, ggf. Adjustment (BDR-6), ggf. Reservation → ISSUED |
| `reserveClothing` | Kontingentjahr | EmployeeReservation (PENDING), AuditLog |
| `cancelReservation` | Kontingentjahr, ggf. Lagerposition | Reservation → CANCELLED, ggf. `Inventory.reserved −`, AuditLog |
| `createPurchaseOrder` | betroffene Reservierungen | Order, OrderItems, Reservations → ORDERED, AuditLog |
| `receiveGoods` | Order, Lagerpositionen, Kontingentjahre betroffener MA | GoodsReceipt(+Items), OrderItem.received, Movements RECEIPT, Reservations → RECEIVED (+ggf. Split), ggf. direkte Ausgabe |
| `returnClothing` | Kontingentjahr, Lagerposition | ClothingReturn(+Items), ggf. Movement RETURN, AuditLog |
| `exchangeClothing` | Kontingentjahr, beide Lagerpositionen | Return(EXCHANGE) + Issue in **einer** Transaktion |
| `adjustQuota` | Kontingentjahr | EmployeeQuotaAdjustment, AuditLog |
| `adjustInventory` | Lagerposition | Movement ADJUSTMENT oder INVENTORY_COUNT, Inventory, AuditLog |
| `changeDepartment` | Employee | EmployeeDepartmentHistory, Employee.departmentId, AuditLog |

---

## D. Datenbankmodell

Konventionen: `id` als `cuid2`-String (nicht erratbar, URL-tauglich). Zeitstempel `timestamptz`. Geld `Decimal(12,2)`. **Alle Fremdschlüssel `ON DELETE RESTRICT`**, niemals Cascade auf Bewegungsdaten. Einzige Ausnahme: reine Kindzeilen ohne eigene Historie, z. B. `EmployeeSize`, und auch dort nur beim Löschen des Mitarbeiters, das es nicht gibt.

### D.1 Identität und Rechte
| Tabelle | Felder (Auszug) | Constraints und Indizes |
|---|---|---|
| **User** | id, email, name, role `enum(ADMIN, MANAGER, RESPONSIBLE)`, active, restrictedToDepartments `bool`, createdAt, updatedAt | UNIQUE(email) |
| Session / Account / Verification | von der Auth-Lösung vorgegeben | |
| **UserDepartmentScope** | userId, departmentId | PK(userId, departmentId) |

### D.2 Organisation und Mitarbeiter
| Tabelle | Felder | Constraints und Indizes |
|---|---|---|
| **Department** | id, code, name, quotaProfileId?, costCenter?, active | UNIQUE(code) |
| **Employee** | id, employeeNumber, firstName, lastName, departmentId, entryDate, exitDate?, status `enum(ACTIVE, INACTIVE, LEFT)`, notes?, createdAt, updatedAt | UNIQUE(employeeNumber); IDX(departmentId), IDX(lastName, firstName), GIN-Trigram(lastName, firstName, employeeNumber); CHECK(exitDate ≥ entryDate) |
| **EmployeeDepartmentHistory** | id, employeeId, departmentId, validFrom, validTo?, changedById, reason? | IDX(employeeId, validFrom); EXCLUDE gegen überlappende Zeiträume je Mitarbeiter (btree_gist) |
| **EmployeeSize** | employeeId, sizeScaleId, **categoryId?**, sizeId, updatedAt | UNIQUE(employeeId, sizeScaleId, categoryId), NULLS NOT DISTINCT |

**Größenmodell:** Größen hängen an einer `SizeScale` (TEXTIL: XS–3XL, HOSE: 46–60, SCHUH: 39–48). Die Mitarbeitergröße wird **je Skala** gespeichert und kann **je Kategorie überschrieben** werden: Standard Textil = XL, Jacke = XXL. Die Vorbelegung im Ausgabedialog nimmt zuerst die Kategorie, dann die Skala. Die tatsächlich ausgegebene Variante steht immer an der Ausgabeposition.

### D.3 Artikel
| Tabelle | Felder | Constraints und Indizes |
|---|---|---|
| **ClothingCategory** | id, name, sizeScaleId?, sortOrder, active | UNIQUE(name) |
| **QuotaGroup** (BDR-1) | id, code, name, isQuotaRelevant, sortOrder, active | UNIQUE(code) |
| **SizeScale** | id, code, name | UNIQUE(code) |
| **Size** | id, sizeScaleId, value, sortOrder | UNIQUE(sizeScaleId, value) |
| **Article** | id, sku, name, description?, categoryId, quotaGroupId, manufacturer?, active, isStockItem, imageUrl?, minStockDefault?, createdAt, updatedAt | UNIQUE(sku); IDX(categoryId), IDX(quotaGroupId); Trigram(sku, name) |
| **ArticleVariant** | id, articleId, sizeId?, color?, barcode?, variantSku, minStock?, active | UNIQUE(articleId, sizeId, color) NULLS NOT DISTINCT; UNIQUE(barcode) WHERE barcode NOT NULL; UNIQUE(variantSku) |
| **Supplier** | id, supplierNumber, name, contactPerson?, email?, phone?, website?, notes?, active | UNIQUE(supplierNumber) |
| **ArticleSupplier** | articleId, supplierId, supplierSku?, purchasePrice?, leadTimeDays?, isPreferred | PK(articleId, supplierId); partieller UNIQUE(articleId) WHERE isPreferred; CHECK(purchasePrice ≥ 0) |

Ein Preis je Variante ist bewusst optional (`ArticleVariantPrice` in Phase 2), weil Größenaufpreise (3XL) vorkommen, im MVP aber nicht nötig sind.

### D.4 Kontingente
| Tabelle | Felder | Constraints und Indizes |
|---|---|---|
| **QuotaProfile** | id, code (z. B. `PRODUKTION_STANDARD`), name, entryRule? `enum(FULL, PRORATED, MANUAL)` (überschreibt die globale Einstellung), active | UNIQUE(code) |
| **QuotaRule** | id, quotaProfileId, quotaGroupId, **validFromYear**, validToYear?, quantityPerYear, createdById, createdAt | UNIQUE(quotaProfileId, quotaGroupId, validFromYear); CHECK(quantityPerYear ≥ 0); CHECK(validToYear ≥ validFromYear) |
| **EmployeeQuotaAdjustment** | id, employeeId, quotaGroupId, year, quantityDelta, **reason (NOT NULL, min. 5 Zeichen)**, source `enum(MANUAL, OVERRIDE, IMPORT)`, relatedIssueId?, createdById, createdAt | IDX(employeeId, year); CHECK(quantityDelta ≠ 0) |
| **QuotaYearLock** | employeeId, year | PK(employeeId, year). Reine Sperrzeile, siehe E.4 |

**Versionierung:** Eine Regel gilt ab `validFromYear`. Für 2027 wird eine neue Regelzeile angelegt; 2025 und 2026 bleiben unberührt. Die für Jahr Y gültige Regel ist die mit dem größten `validFromYear ≤ Y` (und `validToYear` NULL oder ≥ Y).

### D.5 Ausgabe und Rückgabe
| Tabelle | Felder | Constraints und Indizes |
|---|---|---|
| **ClothingIssue** | id, issueNumber, employeeId, **departmentIdSnapshot**, issuedAt, issuedById, status `enum(COMPLETED, CANCELLED)`, cancelledAt?, cancelledById?, cancelReason?, clientRequestId, notes? | UNIQUE(issueNumber), UNIQUE(clientRequestId); IDX(employeeId, issuedAt), IDX(issuedAt) |
| **ClothingIssueItem** | id, issueId, articleVariantId, inventoryLocationId, quantity, **quotaGroupId (Snapshot)**, **quotaYear**, **quotaRelevant**, unitCost?, reservationId?, exchangeOfReturnItemId? | CHECK(quantity > 0); IDX(quotaGroupId, quotaYear); IDX(articleVariantId) |
| **ClothingReturn** | id, returnNumber, employeeId, returnedAt, receivedById, notes? | UNIQUE(returnNumber) |
| **ClothingReturnItem** | id, returnId, issueItemId, quantity, returnType `enum(RETURN_TO_STOCK, EXCHANGE, DEFECTIVE, WRITE_OFF)`, **quotaCreditQuantity**, inventoryLocationId?, reason? | CHECK(quantity > 0); CHECK(0 ≤ quotaCreditQuantity ≤ quantity). Summe der Rückgaben je issueItem ≤ ausgegebene Menge (Prüfung im Service unter Sperre) |

`quotaCreditQuantity` wird vom Service aus der Rückgabeart abgeleitet (BDR-5) und **gespeichert**. Die Kontingentrechnung summiert also Fakten und wertet keine Regeln rückwirkend neu aus.

### D.6 Lager
| Tabelle | Felder | Constraints und Indizes |
|---|---|---|
| **InventoryLocation** | id, code, name, type `enum(STORAGE, DEFECTIVE)`, active | UNIQUE(code) |
| **Inventory** | id, articleVariantId, inventoryLocationId, physicalQuantity, reservedQuantity, minStock?, version, updatedAt | UNIQUE(articleVariantId, inventoryLocationId); **CHECK(physicalQuantity ≥ 0), CHECK(reservedQuantity ≥ 0), CHECK(reservedQuantity ≤ physicalQuantity)** |
| **InventoryMovement** | id, articleVariantId, inventoryLocationId, type `enum(RECEIPT, ISSUE, RETURN, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, INVENTORY_COUNT, RESERVE, UNRESERVE)`, **quantityDelta** (vorzeichenbehaftet, physisch), **reservedDelta**, physicalAfter, reservedAfter, referenceType, referenceId, transferGroupId?, userId, createdAt, reason? | CHECK(quantityDelta ≠ 0 OR type IN (RESERVE, UNRESERVE)); IDX(articleVariantId, createdAt), IDX(referenceType, referenceId), IDX(createdAt) |

- `TRANSFER` ist in zwei Bewegungen mit gemeinsamer `transferGroupId` aufgeteilt, sonst wäre die Bewegung je Lagerort nicht summierbar.
- `RESERVE` und `UNRESERVE` protokollieren Änderungen an `reservedQuantity`, wenn Ware einem Mitarbeiter zugeordnet wird. Dafür gibt es ein eigenes Feld `reservedDelta`; `quantityDelta` ist dann 0.
- `physicalAfter` und `reservedAfter` machen jede Bewegung selbsterklärend und erleichtern Konsistenzprüfungen.
- **Konsistenzinvariante:** `Inventory.physicalQuantity = SUM(InventoryMovement.quantityDelta)` je Variante × Lagerort. Ein Admin-Check (Datenqualitäts-Dashboard) und ein Test prüfen das.

### D.7 Beschaffung
| Tabelle | Felder | Constraints und Indizes |
|---|---|---|
| **EmployeeReservation** | id, employeeId, articleVariantId, quotaGroupId, **quotaYear**, quantity, status `enum(PENDING, ORDERED, RECEIVED, ISSUED, CANCELLED)`, orderItemId?, inventoryLocationId? (sobald RECEIVED + eingelagert), splitFromId?, clientRequestId, createdById, createdAt, cancelledAt?, cancelReason? | CHECK(quantity > 0); IDX(employeeId, quotaYear, status); IDX(status); IDX(orderItemId); UNIQUE(clientRequestId) |
| **Order** | id, orderNumber (Sequenz: `B-2026-00042`), supplierId, orderDate?, expectedDeliveryDate?, status `enum(DRAFT, ORDERED, CONFIRMED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED)`, notes?, createdById, createdAt, updatedAt | UNIQUE(orderNumber); IDX(status), IDX(supplierId), IDX(expectedDeliveryDate) |
| **OrderItem** | id, orderId, articleVariantId, quantityOrdered, quantityReceived, unitPrice | CHECK(quantityOrdered > 0); CHECK(0 ≤ quantityReceived); UNIQUE(orderId, articleVariantId) |
| **GoodsReceipt** | id, receiptNumber, orderId?, supplierId, receivedAt, receivedById, deliveryNoteNumber?, notes? | UNIQUE(receiptNumber) |
| **GoodsReceiptItem** | id, goodsReceiptId, orderItemId?, articleVariantId, inventoryLocationId, quantity | CHECK(quantity > 0) |

**Relation Sammelbestellung:** `OrderItem 1 ── n EmployeeReservation`. Eine Bestellposition „T-Shirt Schwarz XL = 5“ kann z. B. 3 Reservierungen mit zusammen 4 Stück plus 1 Stück Lagerauffüllung enthalten. Die aggregierte Anzeige ist `quantityOrdered`, die Zuordnung sind die verknüpften Reservierungen; der Lageranteil ergibt sich als `quantityOrdered − SUM(reservation.quantity)`. Invariante (im Service geprüft): `SUM(res.quantity) ≤ quantityOrdered`.

**Teilzuteilung:** Deckt eine Lieferung eine Reservierung nur teilweise (Reservierung 2, verfügbar 1), wird sie **gesplittet**: 1 → RECEIVED, 1 bleibt ORDERED (neue Zeile, `splitFromId`). So hat jede Zeile genau einen Status, und die Kontingentrechnung bleibt eine einfache Summe.

### D.8 Querschnitt
| Tabelle | Felder | Hinweise |
|---|---|---|
| **AuditLog** | id, userId?, action (z. B. `QUOTA_ADJUSTED`), entityType, entityId, oldValue `jsonb`, newValue `jsonb`, reason?, requestId?, createdAt | IDX(entityType, entityId), IDX(createdAt), IDX(userId). Nur anhängen: die DB-Rolle der App bekommt kein UPDATE oder DELETE; zusätzlich schützt ein Trigger. Eine Allowlist-Serialisierung verhindert Secrets im Log |
| **Notification** | id, userId, type, title, body, link?, readAt?, createdAt | Tabelle im MVP; nur In-App-Anzeige für Handlungsbedarf, keine E-Mails |
| **AppSetting** | key, value `jsonb`, updatedById, updatedAt | z. B. `quota.entryRule`, `inventory.allowNegative=false` |
| **ImportJob** (Phase 2) | id, type, status, fileName, mapping `jsonb`, errors `jsonb`, createdById | |

**Nicht aufgenommen, mit Begründung:** `Role`-Tabelle (siehe A.3); `Company`/Mandant (Phase 3; nachträglich `tenantId` ergänzen ist machbar, wenn alle Queries über Repository-Funktionen laufen).

### D.9 Lösch- und Deaktivierungskonzept
| Datenart | Löschen? | Stattdessen |
|---|---|---|
| Stammdaten (Department, Article, Variant, Supplier, Location, QuotaProfile, User) | Physisch nur, solange sie nirgends referenziert sind (RESTRICT verhindert den Rest) | `active = false` |
| Employee | nie | `status = LEFT` + `exitDate`. Datenschutz-Löschkonzept siehe unten |
| Bewegungsdaten (Issue, Return, Movement, Reservation, Order, Receipt, Adjustment) | **nie** | Storno-Status + Gegenbuchung |
| AuditLog | nie (App-seitig technisch verhindert) | |

**Datenschutz:** Für ausgeschiedene Mitarbeiter nach der Aufbewahrungsfrist (**BDR-13: wie viele Jahre?**) gibt es eine Pseudonymisierungsfunktion. Sie ersetzt Name und Notizen durch „Ehemalige/r #4711“; die Transaktionen bleiben für Auswertungen erhalten.

---

## E. Kontingent-Engine

### E.1 Formel (je Mitarbeiter × Jahr × QuotaGroup)
```
base        = gültige QuotaRule.quantityPerYear des maßgeblichen Profils
              ggf. anteilig nach BDR-4 (nur im Eintrittsjahr)
adjustments = Σ EmployeeQuotaAdjustment.quantityDelta          (year = Y)
issued      = Σ ClothingIssueItem.quantity                     (quotaYear = Y, quotaRelevant, Issue nicht storniert)
            − Σ ClothingReturnItem.quotaCreditQuantity         (zugehöriges IssueItem.quotaYear = Y)
reserved    = Σ EmployeeReservation.quantity                   (quotaYear = Y, status ∈ {PENDING, ORDERED, RECEIVED})
available   = max(0, base + adjustments − issued − reserved)
overdrawn   = base + adjustments − issued − reserved < 0        → Kennzeichnung in der UI
```
`ISSUED`-Reservierungen zählen nicht doppelt: Sie sind in `issued` enthalten, weil die Ausgabe das `reservationId` trägt. `CANCELLED` zählt nicht.

### E.2 Struktur
- **`computeQuota(input): QuotaLine[]`**: eine **reine Funktion** ohne DB. Sie bekommt Regeln, Anpassungen, Summen, Eintrittsdatum und Einstellung und liefert Zeilen inklusive eines **Nachweises** (`ledger`: Liste der Buchungen mit Datum, Art und Menge). Genau diese Liste zeigt die Detailansicht („15.01.2026 Ausgabe −2“). Fast alle Kontingenttests laufen gegen diese Funktion, schnell und ohne Datenbank.
- **`QuotaService.getEmployeeQuota(employeeId, year, tx?)`**: lädt die Daten mit wenigen aggregierten Queries und ruft `computeQuota` auf. Der optionale `tx` sorgt dafür, dass innerhalb einer Schreibtransaktion **dieselbe** Berechnung **unter Sperre** läuft.
- **`QuotaService.assertAvailable(tx, employeeId, year, quotaGroupId, qty)`**: wirft `DomainError('QUOTA_EXCEEDED', {available, requested})`.
- Die UI bekommt fertige `QuotaLine`-Objekte. Das Frontend rechnet nicht.

Rückgabe:
```ts
type QuotaLine = {
  quotaGroupId: string; quotaGroupName: string; year: number;
  base: number; baseExplanation: string;   // z. B. "Profil PRODUKTION_STANDARD, anteilig 9/12 von 5 = 3,75 → 4"
  adjustments: number; issued: number; reserved: number;
  available: number; overdrawn: boolean;
  ledger: QuotaLedgerEntry[];
};
```

### E.3 Maßgebliches Profil (BDR-3, Empfehlung A)
Die Abteilung am Stichtag (laufendes Jahr: heute, vergangenes Jahr: 31.12., Zukunft: 01.01.) wird aus `EmployeeDepartmentHistory` bestimmt, daraus `Department.quotaProfileId` und die für Y gültige `QuotaRule`.

### E.4 Nebenläufigkeit: Strategie und Begründung
**Gewählt: pessimistische Zeilensperre pro Kontingentjahr in einer `READ COMMITTED`-Transaktion.**

```sql
INSERT INTO "QuotaYearLock"(employee_id, year) VALUES ($1,$2) ON CONFLICT DO NOTHING;
SELECT 1 FROM "QuotaYearLock" WHERE employee_id=$1 AND year=$2 FOR UPDATE;
-- danach Neuberechnung + Prüfung + Schreiben, dann COMMIT
```
Szenario „1 Hose, 2 Benutzer“: A bekommt die Sperre, B wartet in `FOR UPDATE`. A bucht und committet. B bekommt die Sperre, berechnet neu (sieht A's Ausgabe, weil READ COMMITTED ab jetzt neu liest), erhält `available = 0` und damit einen `QUOTA_EXCEEDED`-Fehler mit verständlicher Meldung.

**Warum nicht die Alternativen?**
- *SERIALIZABLE-Isolation:* Das wäre auch korrekt, erzeugt aber Serialisierungsfehler, die jeder Aufrufer mit Retry-Schleifen behandeln muss. Bei Aggregaten über mehrere Tabellen gibt es außerdem schwer vorhersehbare False Positives. Die Sperre ist deterministisch und einfacher zu testen.
- *Optimistisches Locking (Versionsfeld):* Es gibt keine einzelne Zeile, deren Version das Kontingent repräsentiert. Man müsste sie künstlich einführen, und das ist dann genau die Lock-Zeile, nur mit Retry statt Warten.
- *Advisory Locks* (`pg_advisory_xact_lock`) wären gleichwertig. Die Lock-Tabelle ist aber sichtbarer, typsicherer und in Tests leichter zu beobachten.
- *Sperre auf die `Employee`-Zeile:* Das ginge auch, würde aber Stammdatenbearbeitung und Buchungen unnötig serialisieren.

**Lager:** zusätzlich ein bedingtes atomares Update, das die Prüfung selbst enthält:
```sql
UPDATE "Inventory" SET physical_quantity = physical_quantity - $n, version = version + 1
WHERE article_variant_id=$v AND inventory_location_id=$l AND physical_quantity - reserved_quantity >= $n
RETURNING physical_quantity, reserved_quantity;
-- 0 Zeilen → DomainError('STOCK_INSUFFICIENT')
```
Die CHECK-Constraints sind das letzte Sicherheitsnetz: Selbst ein fehlerhafter Codepfad kann keinen negativen Bestand schreiben.

**Deadlock-Vermeidung:** feste Sperrreihenfolge. Erst `QuotaYearLock` (nach employeeId, year sortiert), dann `Order`, dann `Inventory` (nach variantId, locationId sortiert). Das erzwingt ein zentraler Helper `withLocks(tx, {...})`.

**Idempotenz:** `clientRequestId` (UUID aus dem Formular) mit UNIQUE-Constraint. Ein doppeltes Absenden liefert das Ergebnis der ersten Buchung.

Umsetzung mit Prisma: `prisma.$transaction(async tx => …, { isolationLevel: 'ReadCommitted', timeout })`. Sperren und bedingte Updates laufen als parametrisierte `tx.$queryRaw` (Tagged Template, damit ohne SQL-Injection-Risiko), alles andere über den normalen Prisma-Client.

---

## F. Lagerlogik

### F.1 Größen
- `physicalQuantity`: physisch im Regal.
- `reservedQuantity`: davon **bereits einem Mitarbeiter zugeordnet**, also eingetroffene Reservierungsware, die eingelagert statt direkt ausgegeben wurde.
- `available = physical − reserved`: Das kann für normale Ausgaben verwendet werden.

### F.2 Bewegungen je Vorgang
| Vorgang | Bewegung(en) | physical | reserved |
|---|---|---|---|
| Wareneingang Lagerware | RECEIPT +n | +n | |
| Wareneingang für Reservierung, „ins Lager“ | RECEIPT +n, RESERVE | +n | +n |
| Wareneingang für Reservierung, „direkt ausgeben“ | RECEIPT +n, ISSUE −n (derselbe Vorgang) | ±0 | |
| Ausgabe frei verfügbarer Ware | ISSUE −n | −n | |
| Ausgabe reservierter Ware | UNRESERVE, ISSUE −n | −n | −n |
| Storno einer Reservierung mit eingelagerter Ware | UNRESERVE | | −n |
| Rückgabe RETURN_TO_STOCK / EXCHANGE | RETURN +n | +n | |
| Rückgabe DEFECTIVE | RETURN +n am Lagerort `DEFECTIVE` (nicht ausgebbar) oder keine Bewegung | | |
| Umlagerung | TRANSFER_OUT −n / TRANSFER_IN +n | je Ort | |
| Korrektur | ADJUSTMENT ±n (Pflichtbegründung, nur MANAGER/ADMIN) | ±n | |
| Inventur | INVENTORY_COUNT (Differenz zum Zählwert) | ±n | |

Direktausgabe beim Wareneingang bucht bewusst RECEIPT **und** ISSUE. Beide Bewegungen sind so im Journal sichtbar, und die Lagerstatistik (Durchlauf) stimmt.

### F.3 Negative Bestände
Standardmäßig ausgeschlossen, durch das bedingte Update und den CHECK-Constraint. Eine Einstellung `allowNegative` sehe ich **nicht** vor: Das CHECK wäre dann nicht mehr haltbar, und ein negativer Bestand ist fast immer ein Buchungsfehler. Wenn physisch Ware fehlt, muss vorher eine ADJUSTMENT- oder INVENTORY_COUNT-Buchung erfolgen.

### F.4 Mindestbestand und Bestellvorschlag (Phase 3, jetzt schon im Modell)
`Inventory.minStock` (fällt auf `ArticleVariant.minStock` zurück). Vorschlag = `minStock − (physical − reserved) − offen bestellte Lagerware`, sofern positiv. Offene Reservierungen ohne Bestellung kommen dazu. Das System macht nur Vorschläge und sendet nie automatisch.

---

## G. Bestellprozess

### G.1 Zustände
```
Reservation:  PENDING ──(in Bestellung aufgenommen)──> ORDERED ──(Wareneingang)──> RECEIVED ──(Ausgabe)──> ISSUED
                 └────────────── CANCELLED ◄──────────────┴──────────────────────────┘
              (Direktausgabe bei Wareneingang: ORDERED → ISSUED)

Order:        DRAFT ──> ORDERED ──> CONFIRMED ──> PARTIALLY_RECEIVED ──> RECEIVED
                └──────────┴────────────┴──> CANCELLED   (nur ohne bisherigen Wareneingang)
```
Der Status `PARTIALLY_RECEIVED`/`RECEIVED` wird nach jedem Wareneingang **aus den OrderItems abgeleitet** und nicht von Hand gesetzt.

### G.2 Ablauf „Nicht auf Lager → Bestellen“ (MVP)
1. Auf der Mitarbeiterseite „Bestellen“ klicken, Variante (vorbelegt aus der Größe) und Menge wählen.
2. `reserveClothing()` sperrt das Kontingentjahr, prüft Mitarbeiter, Artikel und Kontingent und legt eine `EmployeeReservation(PENDING)` an. Das Kontingent ist sofort reduziert.
3. Die Seite „Offener Bedarf“ (Bestellungen → Bedarf) zeigt alle PENDING-Reservierungen, gruppiert nach Vorzugslieferant → Artikel → Variante.
4. `createPurchaseOrder()`: Der Benutzer wählt Positionen (optional plus Lagermenge) und erhält einen Bestellentwurf (DRAFT). Die Reservierungen werden verknüpft und auf ORDERED gesetzt.
5. „Als bestellt markieren“ (ORDERED) setzt Datum und erwartete Lieferung (Standard: `leadTimeDays` des Lieferanten). Versendet wird nicht aus dem System, sondern per Export oder Druck (**BDR-14: Wird die Bestellung per E-Mail oder PDF aus dem System an den Lieferanten geschickt? Empfehlung: im MVP nein, nur Export**).

Im MVP (Phase 1) ist jede Bestellung einfach: eine Reservierung wird zu einer Bestellung. Die **Sammelbestellung** (mehrere Reservierungen in einer Position) ist technisch schon durch das Datenmodell abgedeckt; die Bedarfsansicht mit Mehrfachauswahl folgt in Phase 2.

### G.3 Wareneingang (`receiveGoods`)
Eingabe: Bestellung, je Position die gelieferte Menge, Lagerort, Lieferscheinnummer.
1. Die Bestellung und die betroffenen Lagerpositionen werden gesperrt. Gegen Überlieferung schützt `received + n ≤ ordered`; ist es mehr, braucht das eine explizite Bestätigung (E15).
2. **Zuteilung:** Die gelieferte Menge geht FIFO (nach `createdAt`) an die ORDERED-Reservierungen dieser Position und wird bei Bedarf gesplittet. Der Rest wird Lagerware.
3. Für jede zugeteilte Reservierung wählt der Benutzer im Dialog „Direkt ausgeben“ (in derselben Transaktion `issueClothing` mit `reservationId`) oder „Ins Lager (reserviert)“. Standard: einlagern, weil die Mitarbeiter selten beim Wareneingang danebenstehen.
4. `OrderItem.quantityReceived` wird erhöht und der Bestellstatus neu abgeleitet.
5. Auf dem Dashboard erscheint der Handlungsbedarf „N eingetroffene Mitarbeiterartikel warten auf Ausgabe“.

### G.4 Kosten
`Order.total = Σ quantityOrdered × unitPrice`. `unitPrice` wird beim Anlegen aus `ArticleSupplier.purchasePrice` vorbelegt und ist danach ein fester Snapshot.

### G.5 Stornierungen
- **Reservierung stornieren:** Das Kontingent wird frei. Hängt die Reservierung an einer Bestellposition, bleibt die Menge bestellt und wird zu Lagerware. Die UI weist darauf hin, damit ggf. die Bestellung reduziert wird. Wurde die Ware schon eingelagert: `UNRESERVE`.
- **Bestellung stornieren:** nur ohne Wareneingang. Verknüpfte Reservierungen gehen zurück auf PENDING (nicht CANCELLED), weil der Bedarf des Mitarbeiters weiter besteht.

---

## H. Rollen- und Berechtigungsmatrix

✅ = erlaubt, 🔸 = nur im eigenen Abteilungs-Scope (wenn der User eingeschränkt ist), ➖ = nicht erlaubt

| Aktion | ADMIN | MANAGER | RESPONSIBLE |
|---|---|---|---|
| Dashboard ansehen | ✅ | ✅ | ✅ (Kennzahlen im Scope) |
| Mitarbeiter ansehen, suchen | ✅ | ✅ | 🔸 |
| Mitarbeiter anlegen und bearbeiten, Größen pflegen | ✅ | ✅ | 🔸 nur Größen und Notizen |
| Abteilung wechseln | ✅ | ✅ | ➖ |
| Kontingent ansehen | ✅ | ✅ | 🔸 |
| Kontingent anpassen (individuell) | ✅ | ✅ | ➖ |
| Ausgabe über das Kontingent hinaus (BDR-6) | ✅ | ✅ | ➖ |
| Kleidung ausgeben, reservieren | ✅ | ✅ | 🔸 |
| Ausgabe stornieren (BDR-8) | ✅ | ✅ | 🔸 eigene, am selben Tag |
| Rückgabe und Umtausch | ✅ | ✅ | 🔸 |
| Bedarf ansehen, Bestellung anlegen und bearbeiten | ✅ | ✅ | ✅ Bedarf ansehen; Bestellungen lesend (BDR-12) |
| Bestellung stornieren | ✅ | ✅ | ➖ |
| Wareneingang buchen | ✅ | ✅ | ✅ |
| Lager ansehen | ✅ | ✅ | ✅ |
| Lagerkorrektur, Inventur | ✅ | ✅ | ➖ |
| Artikel, Varianten, Lieferanten pflegen | ✅ | ✅ | ➖ |
| Kontingentprofile und -regeln | ✅ | ➖ (lesend) | ➖ |
| Abteilungen pflegen | ✅ | ➖ | ➖ |
| Auswertungen und Export | ✅ | ✅ | ➖ |
| Excel-Import | ✅ | ➖ | ➖ |
| Benutzer, Einstellungen | ✅ | ➖ | ➖ |
| Audit Log | ✅ | ✅ (lesend) | ➖ |

**Technik:** `permissions.ts` definiert `can(user, permission, { departmentId? })`. Jede Server Action und jede Route beginnt mit `const actor = await requirePermission('issue:create', { employeeId })`. Die Domänenfunktionen bekommen den `actor` und prüfen den Scope für die tatsächlich betroffene Entität selbst noch einmal (Defense in Depth). Listenabfragen filtern den Scope in der Query selbst, nicht erst hinterher. Die UI verwendet dieselbe `can()`-Funktion nur zum Ausblenden.

---

## I. Seiten- und Navigationsstruktur

```
/login
/                         Dashboard (Kennzahlen, Handlungsbedarf, letzte Vorgänge)
/employees                Liste (Filter: Abteilung, Status; Suche)
/employees/new
/employees/[id]           ★ Detailseite (siehe unten)
/employees/[id]/edit
/departments              Liste + Sheet zum Bearbeiten
/articles                 Arbeitskleidung: Artikel + Varianten
/articles/[id]
/inventory                Lagerbestand (Variante × Ort, Ampel nach Mindestbestand)
/inventory/movements      Bewegungsjournal
/orders                   Tabs: Bedarf | Entwürfe | Offen | Abgeschlossen
/orders/[id]
/goods-receipts           Liste + „Wareneingang buchen“ (aus Bestellung)
/reports                  (Phase 2) Ausgaben, Kosten, Lager, Bestellungen
/admin/quotas             Kontingentprofile, Regeln je Jahr, Kontingentgruppen
/admin/suppliers
/admin/users
/admin/settings           Eintrittsregel, Lagerorte, Größenskalen
/admin/audit-log
/admin/data-quality       (Phase 2)
/admin/import             (Phase 2)
```

**Globale Suche:** Command-Palette (`⌘K` / `Strg+K`, shadcn `Command`) in der Kopfzeile. Serverseitig läuft eine Query über `pg_trgm` (Ähnlichkeit plus Präfix) auf Name, Personalnummer, SKU, Artikelname und Bestellnummer, mit GIN-Indizes, gefiltert nach Rollen-Scope. Ein Mitarbeitertreffer zeigt direkt die **Schnellansicht** (Kontingentzeilen mit „verfügbar“) und den Button „Ausgabe / Bestellung“, der die Detailseite mit geöffnetem Ausgabedialog aufruft.

**Mitarbeiterdetailseite (`/employees/[id]`), Layout Desktop:**
```
┌ Kopf: Max Mustermann · PNr 4711 · [Produktion] · [● Aktiv] · Jahr [2026 ▾]   [Kleidung ausgeben / bestellen] [⋯ Bearbeiten]
├──────────────────────────────────────────────┬───────────────────────────┐
│ Kontingent 2026 (Tabelle)                    │ Größen                    │
│ Gruppe | Anspruch | Anp. | Erh. | Res. | Verf.│ Textil XL · Jacke XXL     │
│ T-Shirt|    5     |  0   |  2   |  1   | [2] │ Hose 54 · Schuh 44  [✎]   │
│ Hose   |    2     | +1   |  1   |  0   | [2] ├───────────────────────────┤
│  └ Klick → Sheet mit Nachweis (Ledger)       │ Offene Reservierungen     │
│                                              │ Hose 54 · bestellt · KW 42│
├──────────────────────────────────────────────┴───────────────────────────┤
│ Tabs: Historie | Bestellungen | Notizen | Änderungen (Audit)             │
└──────────────────────────────────────────────────────────────────────────┘
```
**Ausgabedialog (ein Dialog für Ausgabe und Bestellung):** Kontingentgruppe wählen → Artikel (vorausgewählt, wenn die Gruppe nur einen hat) → Größenraster mit vorbelegter Mitarbeitergröße, Lagerbestand je Größe direkt an den Größen-Buttons (`XL · 12`, `XXL · 0`) → Menge (max. = verfügbares Kontingent). Der Hauptbutton heißt „**Ausgeben**“, wenn Lager vorhanden ist, sonst „**Bestellen**“. Mehrere Positionen in einem Vorgang sind möglich. Typischer Fall: **3–4 Klicks** ab geöffnetem Mitarbeiter.

**Statusdarstellung:** Eine zentrale `<StatusBadge status=…>` mit Farbe, Icon und Text (z. B. 🔴 + `AlertTriangle` + „Überfällig“). So hängt die Bedeutung nie an der Farbe allein. Farbschema wie vorgegeben: Grün, Gelb, Rot, Blau, Grau.

---

## J. MVP-Plan (Implementierungsreihenfolge)

Jeder Schritt endet mit: `tsc --noEmit`, `eslint`, relevanten Tests, `prisma migrate` prüfen, einer kurzen Zusammenfassung und offenen Punkten. Jeder Schritt ist ein eigener Commit (Git-Repo wird in Schritt 0 angelegt).

**Phase 1: MVP**
| # | Schritt | Inhalt | Ergebnis |
|---|---|---|---|
| 0 | foundation | Aktuelle stabile Versionen prüfen (Next.js, Prisma, Auth-Lösung, Tailwind, shadcn, Zod), Projekt anlegen, ESLint/Prettier, Vitest, Ordnerstruktur, `env.ts` (Zod-validiert), Fehlerklassen, Logger | App startet, CI-Skripte laufen |
| 1 | database | Prisma-Schema komplett für Phase 1 + Tabellen, die Phase 2 braucht; SQL-Migration für CHECK/EXCLUDE/Trigram/Audit-Trigger; Test-DB-Setup | `migrate dev` grün, Constraint-Tests |
| 2 | authentication | Login, Sessions, `requirePermission`, Rollen-Matrix, Scope, Rate Limit Login, Benutzerverwaltung (Admin) | Autorisierungs-Tests |
| 3 | audit | `audit(tx, …)`-Helper mit Allowlist-Serialisierung. Kommt früh, weil alle folgenden Prozesse ihn verwenden | |
| 4 | departments + employees | CRUD für Abteilungen, Mitarbeiter mit Größen, `changeDepartment`, Liste mit TanStack Table | |
| 5 | articles | Kategorien, Kontingentgruppen, Größenskalen, Artikel, Varianten (Größenmatrix-Generator), Lieferanten + ArticleSupplier | |
| 6 | quota-engine | `computeQuota` (rein) + `QuotaService` + Profile und Regeln (Admin-UI) + `adjustQuota` | umfangreiche Unit-Tests |
| 7 | inventory | Lagerorte, Bestandsübersicht, `adjustInventory`, Bewegungsjournal, Konsistenzcheck | |
| 8 | issues | `issueClothing` inkl. Sperrstrategie, Storno, **Mitarbeiterdetailseite + Ausgabedialog** | Nebenläufigkeitstests |
| 9 | reservations + orders | `reserveClothing`, `cancelReservation`, Bedarfsliste, einfache Bestellung (eine Reservierung pro Bestellung oder Lagerbestellung), Bestellstatus | |
| 10 | goods-receipt (einfach) | Vollständiger Wareneingang je Position, einlagern/direkt ausgeben *(aus Phase 2 vorgezogen, siehe A.3)* | |
| 11 | dashboard + search | Kennzahlen, Handlungsbedarf, globale Suche + Schnellansicht | |
| 12 | seed | Realistische Demodaten (Abschnitt 38 der Vorgaben), über die Domänenfunktionen erzeugt statt per Roh-Insert, damit auch die Seeds die Invarianten einhalten | |
| 13 | e2e + docker + docs | Playwright-Kernflüsse, Dockerfile (multi-stage, `output: standalone`), Compose mit Healthchecks, README inkl. Backup/Restore | |

**Phase 2:** Sammelbestellungen (Bedarfs-Mehrfachauswahl), Teillieferungen + FIFO-Split, Rückgabe, Umtausch, Reports + CSV/Excel-Export, Excel-Import-Assistent, Datenqualitäts-Dashboard, Kostenbewertung mit gleitendem Durchschnitt.
**Phase 3:** Barcode/QR, Inventur-Modus, Bestellvorschläge, Kostenstellen und Budgets, E-Mail-Benachrichtigungen, Multi-Warehouse-UI, Mandanten, Mehrsprachigkeit.

**Komplexitätsprüfung, bewusst weggelassen oder vereinfacht:**
- Keine Rollentabelle, kein generisches Permission-System.
- Kein Event-Sourcing-Framework. Das Journal besteht aus normalen Tabellen plus Projektion in derselben Transaktion.
- Keine Queue und kein Redis. Rate Limiting im MVP über die Auth-Lösung bzw. einen In-Memory-Limiter; das reicht bei einer Instanz und ist dokumentiert.
- Kein separates API-Backend: Server Actions für Mutationen, Route Handlers nur für Export, Import und Healthcheck.
- Ein Lagerort im MVP, im Modell aber schon mehrere.
- Excel-Export über eine Library erst in Phase 2; im MVP gibt es CSV.

---

## K. Wichtigste automatisierte Tests

**Unit (reine Funktion `computeQuota`, ohne DB)**
1. Teilabruf: 5 Anspruch, Ausgaben 2 + 1 → verfügbar 2
2. Vollständig verbraucht: 2 + 1 + 2 → 0
3. Individuelle Anpassung +2 → verfügbar steigt um 2
4. Reservierung PENDING/ORDERED/RECEIVED reduziert, CANCELLED und ISSUED nicht doppelt
5. Rückgaben: RETURN_TO_STOCK und DEFECTIVE mit Gutschrift, WRITE_OFF ohne
6. Umtausch ist netto neutral
7. PRORATED: Eintritt 01.01., 15.04., 01.11., 31.12. mit Basis 1, 2 und 5 (Tabelle aus BDR-4); FULL; MANUAL
8. Regelversionierung: Regel 2027 ändert 2026 nicht
9. Abteilungswechsel: Stichtagsprofil, historische Ausgaben unverändert, `overdrawn` wird korrekt markiert
10. Stornierte Ausgabe zählt nicht

**Integration (echtes PostgreSQL, Domänenfunktionen)**

11. Ausgabe reduziert Lager und Kontingent, schreibt Movement und AuditLog
12. Überschreitung verhindert (`QUOTA_EXCEEDED`); Lager unverändert, keine Teilbuchung (Atomarität)
13. Admin-Sonderfreigabe erzeugt Adjustment + Issue; RESPONSIBLE wird abgewiesen
14. Stornierung einer Reservierung gibt das Kontingent frei
15. **Gleichzeitige Ausgabe:** 1 verfügbar, 2 parallele Transaktionen (`Promise.all` mit getrennten Connections) → genau 1 Erfolg, 1 `QUOTA_EXCEEDED`
16. **Gleichzeitige Reservierung:** analog
17. **Gleichzeitiger Lagerzugriff** zweier Mitarbeiter auf das letzte Stück → genau 1 Erfolg
18. Bestand kann nicht negativ werden: Service-Pfad **und** direktes Raw-UPDATE scheitern am CHECK
19. Wareneingang für eine Reservierung: einlagern (reserved+) → späterer Issue (reserved−, physical−)
20. Teillieferung: 10 bestellt, 6 geliefert → 4 offen, Status PARTIALLY_RECEIVED, FIFO-Split korrekt (Phase 2)
21. Rückgabe und Umtausch inkl. Jahreswechsel (Dezember ausgegeben, Januar getauscht) (Phase 2)
22. Idempotenz: dieselbe `clientRequestId` zweimal → eine Buchung
23. Konsistenz: nach jedem Integrationstest gilt `Inventory.physical = Σ movements`
24. Autorisierung: RESPONSIBLE mit Scope kann Mitarbeiter fremder Abteilungen weder lesen noch buchen
25. AuditLog enthält keine Felder aus der Denylist (Passwort, Token, Hash)
26. Fehlerübersetzung: P2002 auf employeeNumber → „Die Personalnummer 4711 wird bereits verwendet.“

**E2E (Playwright)**
- Login → Mitarbeiter suchen → öffnen → T-Shirt XL ausgeben → Kontingent und Bestand aktualisiert
- Nicht auf Lager → bestellen → Bestellung anlegen → Wareneingang → ausgeben
- RESPONSIBLE sieht keine Admin-Navigation und bekommt auch bei direktem URL-Aufruf 403

---

## L. Projektstruktur

```
arbeitskleidung/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/                 # inkl. handgeschriebener SQL-Teile (CHECK, EXCLUDE, pg_trgm, Trigger)
│  └─ seed.ts
├─ src/
│  ├─ app/                        # nur Routing, Layouts, Seiten: dünn, keine Geschäftslogik
│  │  ├─ (auth)/login/
│  │  ├─ (app)/layout.tsx         # Sidebar, Header, Suche
│  │  ├─ (app)/employees/[id]/page.tsx
│  │  ├─ (app)/admin/...
│  │  └─ api/{auth,export,health}/route.ts
│  ├─ modules/                    # fachliche Module (vertikale Schnitte)
│  │  ├─ quotas/
│  │  │  ├─ domain/               # rein: computeQuota, proration, Typen (keine Imports von prisma/next)
│  │  │  ├─ server/               # QuotaService, adjustQuota, Queries  (import 'server-only')
│  │  │  ├─ actions.ts            # Server Actions: Auth → Zod → Domänenfunktion → revalidate
│  │  │  ├─ schemas.ts            # Zod-Schemas (Client + Server)
│  │  │  └─ components/           # QuotaTable, QuotaLedgerSheet
│  │  ├─ employees/  departments/  articles/  suppliers/
│  │  ├─ inventory/  issues/  reservations/  orders/  goods-receipts/
│  │  ├─ returns/ (P2)  reports/ (P2)  import/ (P2)
│  │  ├─ users/  audit/  dashboard/  search/
│  ├─ server/                     # technischer Kern
│  │  ├─ db.ts                    # Prisma-Client-Singleton
│  │  ├─ tx.ts                    # runInTransaction, withLocks (Sperrreihenfolge)
│  │  ├─ auth.ts                  # Session → Actor
│  │  ├─ permissions.ts           # Matrix + can()/requirePermission()
│  │  ├─ audit.ts                 # audit(tx, …) mit Allowlist
│  │  ├─ errors.ts                # DomainError-Codes → deutsche Meldungen; Prisma-Fehler-Mapping
│  │  ├─ numbering.ts             # Belegnummern über PG-Sequenzen
│  │  └─ logger.ts
│  ├─ components/
│  │  ├─ ui/                      # shadcn (generiert)
│  │  └─ shared/                  # DataTable, StatusBadge, EmptyState, ConfirmDialog, PageHeader
│  ├─ lib/                        # framework-agnostische Utils (Datum, Format, cn)
│  └─ env.ts                      # Zod-validierte Environment Variables
├─ tests/
│  ├─ unit/                       # oder co-located *.test.ts in domain/
│  ├─ integration/                # echte DB, setup.ts (Schema pro Worker, truncate)
│  └─ e2e/                        # Playwright
├─ docker/  Dockerfile  docker-compose.yml  .env.example
└─ README.md  docs/KONZEPT.md  docs/adr/
```

**Begründung:** `modules/` statt `features/`, weil jedes Modul Domäne, Server, Actions und UI enthält, also mehr als ein UI-Feature ist. Die Schichtregel ist `app → modules/*/actions → modules/*/server → modules/*/domain`. `domain/` importiert weder Prisma noch Next, deshalb lässt sich die Kernlogik isoliert testen und nicht versehentlich im Client bündeln. Modulübergreifende Aufrufe gehen nur über die öffentlichen Server-Funktionen eines Moduls; `issues` ruft z. B. `quotas/server` auf und nie direkt dessen Tabellen. Eine ESLint-Regel (`no-restricted-imports`) erzwingt die Grenzen.

---

## Technologie-Vorschlag (Versionen werden in Schritt 0 gegen die offizielle Dokumentation geprüft)

| Bereich | Wahl | Begründung |
|---|---|---|
| Framework | Next.js (aktuelles stabiles Major), App Router, Server Actions | Vorgabe; Server Actions bringen Origin-Prüfung gegen CSRF mit |
| Auth | **Better Auth** (Alternative: Auth.js) | Stabile Credentials- und Session-Unterstützung mit Prisma-Adapter, eingebautes Rate Limiting, SSO-Plugins für später. Auth.js ist für reinen Credentials-Login mit DB-Sessions umständlicher. Entscheidung fällt nach dem Doku-Check in Schritt 0 |
| DB/ORM | PostgreSQL + Prisma | Vorgabe; Raw-SQL nur für Sperren, bedingte Updates, Trigram-Suche und Constraints |
| Validierung | Zod | Gemeinsame Schemas für Formular und Server |
| UI | Tailwind, shadcn/ui, Lucide, TanStack Table, React Hook Form, sonner (Toasts) | Vorgabe |
| Tests | Vitest (Unit + Integration gegen echtes Postgres), Playwright | Die Nebenläufigkeitstests brauchen eine **echte** DB, SQLite oder Mocks reichen nicht |
| Excel (P2) | exceljs | Lesen und Schreiben, aktiv gepflegt, über npm verfügbar |

**Hinweis zur lokalen Umgebung:** Auf diesem Rechner sind Node 25 vorhanden, aber **weder Docker noch PostgreSQL**. Für Entwicklung und Integrationstests brauche ich eins von beiden. Empfehlung: Docker Desktop oder OrbStack, weil das auch dem Deployment-Ziel entspricht. Alternative: `brew install postgresql@17`. Für die Laufzeit empfehle ich die aktuelle Node-LTS statt Node 25 (im Docker-Image ohnehin).

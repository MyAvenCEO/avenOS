# Scenario: Invoice Processing

## Context

Accounts payable receives an invoice from a vendor. The system needs to verify it against purchase orders, flag for approval if over a threshold, and process for payment.

## Initial Invoice

```
From: invoices@vendor-acme.com
To: ap@company.com
Subject: Invoice INV-2024-0420

Invoice #: INV-2024-0420
Date: May 8, 2024
Due: June 7, 2024
Vendor: Acme Supplies Inc
Total: $47,500.00

Line Items:
- Server Equipment Rack (Qty 4) @ $8,000 = $32,000
- Network Switches (Qty 6) @ $2,500 = $15,000
- Installation & Setup = $500

Payment Terms: Net 30
```

## Step-by-Step Flow

### Step 1: Invoice received, Intent created

```
SOURCE: Email/webhook
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Receives: invoice email with PDF attachment         │
│  - Intent Matching: No match (new vendor? new topic?)  │
│  - Decision: CREATE new Intent for "Acme Invoice"      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: ap-review-0420                                │
│  Topic: "Invoice Review: Acme #INV-2024-0420"         │
│  Status: active                                        │
│  Events: [                                             │
│    { source: 'user', type: 'invoice_received',         │
│      data: { vendor: 'Acme Supplies',                  │
│              amount: 47500,                            │
│              dueDate: 'June 7' } }                     │
│  ]                                                     │
│  Context: {                                            │
│    invoiceId: 'INV-2024-0420',                         │
│    vendor: 'Acme Supplies Inc',                        │
│    amount: 47500,                                      │
│    threshold: 50000,  // flag if over this            │
│    relevantSkills: ['ingest', 'memory']                │
│  }                                                     │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Route to Ingest Skill Agent (archive + extract PDF) │
│  - Notify Intent: invoice_received                      │
└─────────────────────────────────────────────────────────┘
```

### Step 2: Ingest skill archives invoice

```
┌─────────────────────────────────────────────────────────┐
│  Ingest Skill Agent                                     │
│  - Task: "Download and archive invoice PDF from email" │
│  - Spawns Ingest Worker: pdf-handler                   │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Ingest Worker (pdf-handler)                            │
│  1. Downloads attached PDF                              │
│  2. Archives to: /tmp/ingest/inv-2024-0420.pdf         │
│  3. Extracts metadata:                                  │
│     - Invoice number                                   │
│     - Vendor details                                   │
│     - Line items                                       │
│     - Amounts                                          │
│  4. Registers metadata in Memory Worker                │
│     (direct call to Memory Skill Agent)                │
│  5. Reports: archivePath, metadata                     │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Ingest Skill Agent                                     │
│  - Worker completes, removed from pool                 │
│  - Returns to Dispatcher: { archivePath, metadata }   │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Notifies Intent: invoice_ingested                   │
│  - Intent logs: invoice_ingested, archivePath stored   │
│  - Intent updates: context.archivePath = path          │
└─────────────────────────────────────────────────────────┘
```

### Step 3: Memory lookup for vendor verification

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Check Acme Supplies Inc in vendors"          │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Skill Agent                                     │
│  - Spawns Memory Worker: vendors                       │
│  - Worker reads: vendors.md                            │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (vendors)                                │
│  - Search: "Acme Supplies"                             │
│  - Found:                                              │
│    ## Acme Supplies Inc                                │
│    - Contact: Bob Smith (bob@acme.com)                 │
│    - Account #: ACME-001                               │
│    - Payment terms: Net 30                             │
│    - Credit limit: $100,000                            │
│    - Status: Active                                    │
│    - POs on file: PO-2024-0100, PO-2024-0115          │
│  - Returns: vendor details                             │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Skill Agent                                     │
│  - Also check for PO: "PO-2024-0115" (latest Acme PO) │
│  - Returns to Dispatcher                                │
└─────────────────────────────────────────────────────────┘
```

### Step 4: PO verification

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Find PO-2024-0115 details"                   │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (orders)                                 │
│  - Reads: orders.md                                     │
│  - Find PO-2024-0115:                                  │
│    ## PO-2024-0115                                     │
│    Vendor: Acme Supplies Inc                           │
│    Date: April 15, 2024                                │
│    Items:                                              │
│    - Server Equipment Rack (Qty 4) @ $8,000           │
│    - Network Switches (Qty 6) @ $2,500                │
│    - Installation & Setup @ $500                       │
│    Total: $47,500                                      │
│    Status: Approved                                    │
│    Approved by: CFO                                    │
│  - Returns: PO details                                 │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Skill Agent → Dispatcher                         │
│  - PO total: $47,500                                   │
│  - Invoice total: $47,500                              │
│  - Match: YES (perfect match)                          │
│  - Flag: NO (under $50k threshold, no approval needed) │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Intent: ap-review-0420                   │
│  - Notify: verification_complete                       │
│  - Intent logs:                                        │
│    - vendor_verified: Acme Supplies Inc (active)      │
│    - po_verified: PO-2024-0115 matches invoice        │
│    - amount_verified: $47,500 = $47,500 (match)       │
│    - approval_needed: NO (under threshold)            │
│  - Intent updates: summary = "Invoice verified.       │
│    PO match confirmed. Ready for payment processing." │
└─────────────────────────────────────────────────────────┘
```

### Step 5: Payment processing triggered

```
┌─────────────────────────────────────────────────────────┐
│  Intent: ap-review-0420                                 │
│  - Status: pending (awaiting payment execution)        │
│  - Context: {                                           │
│      invoiceId: 'INV-2024-0420',                       │
│      vendor: 'Acme Supplies Inc',                      │
│      amount: 47500,                                    │
│      dueDate: 'June 7, 2024',                          │
│      approved: true,                                   │
│      paymentAccount: 'Operating Account'              │
│    }                                                   │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Human Inbox                               │
│  Subject: "Ready for Payment: Acme Invoice #INV-2024-0420"
│  Body:                                                 │
│  Invoice: INV-2024-0420                                │
│  Vendor: Acme Supplies Inc                             │
│  Amount: $47,500.00                                    │
│  Due: June 7, 2024                                     │
│  PO: PO-2024-0115 (verified match)                    │
│  Status: Ready for payment                             │
│  Action: [Schedule Payment] [Hold] [Query]            │
└─────────────────────────────────────────────────────────┘
```

### Step 6: AP clerk initiates payment

```
┌─────────────────────────────────────────────────────────┐
│  Human → Dispatcher                                     │
│  - Action: "Schedule payment for INV-2024-0420"        │
│  - Intent Matching: ap-review-0420                     │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Intent: ap-review-0420                   │
│  - Notify: payment_scheduled                           │
│  - Intent logs: payment_scheduled                      │
│  - Intent updates: context.paymentDate = 'May 15'      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Record: Invoice INV-2024-0420 scheduled      │
│    for payment on May 15, from Operating Account"      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (orders)                                 │
│  - Appends to orders.md:                               │
│    ## May 15                                           │
│    Invoice INV-2024-0420 (Acme Supplies) scheduled    │
│    for payment: $47,500 from Operating Account        │
│    Payment date: May 15, 2024                         │
└─────────────────────────────────────────────────────────┘
```

### Step 7: Payment executes, case closes

```
┌─────────────────────────────────────────────────────────┐
│  External System → Dispatcher                           │
│  - Event: payment_executed                             │
│  - Invoice: INV-2024-0420                              │
│  - Amount: $47,500                                     │
│  - Transaction ID: TXN-2024-0515-0042                  │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Intent: ap-review-0420                   │
│  - Route: payment_complete                             │
│  - Intent logs: payment_executed                       │
│  - Intent updates:                                     │
│    - context.paymentTxnId = 'TXN-2024-0515-0042'      │
│    - summary = "Payment executed May 15. Invoice paid."│
│    - status: resolved                                  │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Update: Invoice INV-2024-0420 paid.          │
│    TXN: TXN-2024-0515-0042"                           │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (orders)                                 │
│  - Appends to orders.md:                               │
│    ## May 15                                           │
│    Invoice INV-2024-0420 PAID                          │
│    TXN: TXN-2024-0515-0042                            │
│    Amount: $47,500                                     │
│    From: Operating Account                             │
│    To: Acme Supplies Inc                               │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Human Inbox                                            │
│  Subject: "Payment Complete: INV-2024-0420"           │
│  Amount $47,500 paid to Acme Supplies Inc              │
└─────────────────────────────────────────────────────────┘
```

## Summary

| Event | Intent Updated | Skills Invoked |
|-------|---------------|----------------|
| Invoice received | ✅ Created | Ingest |
| Invoice archived | ✅ | Ingest |
| Vendor verified | ✅ | Memory |
| PO verified | ✅ | Memory |
| Payment scheduled | ✅ | Memory |
| Payment executed | ✅ | Memory |

## Final State

```
Intent: ap-review-0420
  Status: resolved
  Summary: "Invoice INV-2024-0420 paid. $47,500 to Acme Supplies Inc."
  Events: [
    invoice_received,
    invoice_ingested,
    vendor_verified,
    po_verified,
    amount_verified,
    payment_scheduled,
    payment_executed
  ]
```

## Key Pattern Demonstrated

1. **Document lifecycle**: Invoice ingested → archived → metadata extracted
2. **Verification chain**: Invoice matched against PO via Memory
3. **Threshold logic**: System flags approval only when needed
4. **Payment tracking**: Payment execution recorded in Memory
5. **Audit trail**: Every step logged in Intent events

---

**Variations:**

### Over-Threshold Invoice (>$50,000)

```
┌─────────────────────────────────────────────────────────┐
│  Intent: ap-review-0420                                 │
│  - Amount: $67,500 (over $50k threshold)               │
│  - Status: pending_approval                            │
│  - Context: { approvalNeeded: true, approvers: ['CFO']}│
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Human Inbox                               │
│  Subject: "APPROVAL NEEDED: Acme Invoice $67,500"     │
│  Body: Invoice exceeds $50k threshold. CFO approval   │
│  required. [Approve] [Reject] [Query]                 │
└─────────────────────────────────────────────────────────┘
```

### Invoice Mismatch

```
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (orders)                                 │
│  - PO-2024-0115 total: $47,500                        │
│  - Invoice total: $48,200                              │
│  - MISMATCH: $700 difference                          │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Human Inbox                               │
│  Subject: "DISCREPANCY: Acme Invoice #INV-2024-0420"  │
│  PO Amount: $47,500                                    │
│  Invoice Amount: $48,200                               │
│  Difference: $700                                      │
│  Action needed before payment.                         │
└─────────────────────────────────────────────────────────┘
```
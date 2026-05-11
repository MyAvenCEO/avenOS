# Scenario: Customer Email Processing

## Context

A customer emails support@example.com about a delayed shipment for order #12345. This triggers the system.

## Initial Email

```
From: customer@client.com
To: support@example.com
Subject: Where is my order #12345?

Hi,

I ordered items on May 5th but haven't received shipping confirmation yet.
Order #12345 - can you check on this?

Thanks,
John Customer
```

## Step-by-Step Flow

### Step 1: Email received, Intent created

```
SOURCE: Email system webhook
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Receives: { type: 'email', from: 'customer@...',    │
│                subject: 'Where is my order #12345?',   │
│                body: '...' }                           │
│  - Intent Matching: No existing Intent matches          │
│  - Decision: CREATE new Intent                         │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: support-case-#12345                           │
│  Topic: "Support Case: Order #12345"                   │
│  Status: active                                        │
│  Events: [                                             │
│    { timestamp, source: 'user', type: 'email_received',│
│      data: { from: 'customer@client.com',              │
│              subject: 'Where is my order #12345?' } }  │
│  ]                                                     │
│  Context: {                                            │
│    orderId: '12345',                                   │
│    customerEmail: 'customer@client.com',               │
│    relevantSkills: []                                  │
│  }                                                     │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Route to Skill Agent: memory (to check order)       │
│  - Notify Intent: email_received                        │
└─────────────────────────────────────────────────────────┘
```

### Step 2: Memory lookup for order

```
┌─────────────────────────────────────────────────────────┐
│  Memory Skill Agent                                     │
│  - Task: "Find order #12345 information"               │
│  - Spawns Memory Worker: "orders"                      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (orders)                                 │
│  - Reads: orders.md                                     │
│  - Finds: Order #12345                                  │
│    - Customer: John Customer, customer@client.com       │
│    - Items: Widget A, Widget B                          │
│    - Status: processing                                 │
│    - Expected ship date: May 10                         │
│    - Delay reason: supply chain issue                  │
│  - Returns: order details to Skill Agent               │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Skill Agent                                     │
│  - Returns: order details to Dispatcher                │
│  - Worker completes, removed from pool                 │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Notifies Intent: order_found                        │
│  - Intent updates: context.orderDetails = {...}        │
│  - Intent updates: summary = "Customer inquiring about │
│    order #12345, delayed due to supply chain"          │
└─────────────────────────────────────────────────────────┘
```

### Step 3: Human gets notification (dispatcher → human inbox)

```
┌─────────────────────────────────────────────────────────┐
│  Human Inbox (e.g., email to support team)              │
│  Subject: "New: Support Case - Order #12345"           │
│  Body:                                                  │
│  Customer: John Customer (customer@client.com)         │
│  Issue: Shipping confirmation not received             │
│  Order Status: Processing (delayed)                    │
│  Expected Ship: May 10 (delayed due to supply chain)   │
│  Intent: support-case-#12345                          │
└─────────────────────────────────────────────────────────┘
```

### Step 4: Support agent responds, system learns

```
From: support@example.com
To: customer@client.com
Subject: Re: Where is my order #12345?

Hi John,

Thank you for reaching out. Your order #12345 is currently 
processing and expected to ship by May 12 (delayed due to 
supply chain issues).

We apologize for the delay. You'll receive tracking 
information as soon as it ships.

Best,
Support Team
```

```
┌─────────────────────────────────────────────────────────┐
│  Human → Dispatcher: Email reply received               │
│  - Intent Matching: support-case-#12345                │
│  - Route to Intent: email_response                     │
│  - Intent logs: human_response                         │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: support-case-#12345                           │
│  - Logs: human_sent_response                           │
│  - Updates: summary = "Response sent to customer.      │
│    Order delayed, ship date May 12."                   │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Remember: order #12345 update - delay        │
│    explained to customer, new ship date May 12"        │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (orders)                                 │
│  - Appends to orders.md:                               │
│    ## May 11                                           │
│    Customer inquired about delay.                      │
│    Explained supply chain issue. New ship date May 12.│
└─────────────────────────────────────────────────────────┘
```

### Step 5: Order ships, system processes

```
┌─────────────────────────────────────────────────────────┐
│  External System → Dispatcher                           │
│  - Event: order_shipped                                │
│  - Order: #12345, tracking: 1Z999ABC123456789         │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Intent Matching: support-case-#12345                │
│  - Route to Intent: order_shipped                      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: support-case-#12345                           │
│  - Logs: order_shipped                                 │
│  - Updates: summary = "Order shipped. Awaiting         │
│    delivery confirmation."                             │
│  - Context: { trackingNumber: '1Z999ABC123456789' }   │
│  - Status: pending (waiting for delivery confirmation) │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Ingest Skill Agent: "ingest tracking page"          │
│  - Extract Skill Agent: "track delivery"               │
│  - Human: "Order #12345 shipped, tracking #..."       │
└─────────────────────────────────────────────────────────┘
```

### Step 6: Customer confirms delivery, case closes

```
From: customer@client.com
To: support@example.com
Subject: Re: Where is my order #12345?

Received! Thanks!

┌─────────────────────────────────────────────────────────┐
│  Human → Dispatcher                                     │
│  - Intent Matching: support-case-#12345                │
│  - Route to Intent: customer_confirmed_delivery        │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: support-case-#12345                           │
│  - Logs: customer_confirmed_delivery                   │
│  - Updates: summary = "Order delivered. Customer       │
│    confirmed. Case resolved."                          │
│  - Status: resolved                                    │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Memory: update order #12345 status = delivered      │
│  - Human: "Case support-case-#12345 resolved"         │
└─────────────────────────────────────────────────────────┘
```

## Summary

| Event | Intent Updated | Skills Invoked |
|-------|---------------|----------------|
| Email received | ✅ Created | - |
| Order lookup | ✅ | Memory |
| Email sent to customer | ✅ | Memory |
| Order shipped | ✅ | Ingest, Extract |
| Delivery confirmed | ✅ | Memory |

## Final State

```
Intent: support-case-#12345
  Status: resolved
  Summary: "Order #12345 delivered. Customer satisfied."
  Events: [
    email_received,
    order_found,
    human_response_sent,
    order_shipped,
    delivery_tracked,
    customer_confirmed_delivery
  ]
```

---

**Key Pattern Demonstrated:**
1. Intent tracks entire case lifecycle
2. Every event notifies relevant Intent
3. Skills report through Dispatcher to Intent
4. Human responses routed through Intent for context
5. Memory persists learnings for future reference
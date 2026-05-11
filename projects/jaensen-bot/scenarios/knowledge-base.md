# Scenario: Knowledge Base Management

## Context

A team leader wants to build up institutional knowledge about competitors. They periodically ingest news, analyst reports, and internal research. The system maintains dossiers on companies and tracks key events.

## Initial Setup

```
SOURCE: Team Leader (user)
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - User message: "Track competitor Apple for Project X" │
│  - Intent Matching: Check if Intent exists for          │
│    "Project X" or "Apple competitor tracking"          │
│  - Found: Intent "project-x" exists (team leader)      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - User message received: "Track Apple"                │
│  - Context: {                                         │
│      focus: ['competitors', 'Apple', 'technology'],   │
│      competitorTracking: true                         │
│    }                                                  │
│  - Creates new Memory Worker: companies                │
│    (spawned via Memory Skill Agent)                   │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (companies)                              │
│  - Creates new thread in companies.md:                 │
│    # Apple Inc                                         │
│    Added to Project X tracking on May 11, 2024        │
│    Focus: technology, competitive analysis             │
└─────────────────────────────────────────────────────────┘
```

## Step 1: Team member sends news article

```
From: team-member@company.com
To: knowledge@company.com
Subject: Apple announcement

FYI - Apple announced new AI features today. Link:
https://news.site/apple-ai-announcement
```

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Email received with URL                             │
│  - Intent Matching: "Project X" (team member context) │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - Logs: news_article_received                         │
│  - Intent updates:                                     │
│    - summary = "Ongoing competitor tracking.           │
│      New Apple news received."                         │
│    - context.newsSources.push(url)                     │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Ingest Skill Agent                        │
│  - Task: "Ingest URL: https://news.site/apple-ai-..."  │
│  - Metadata: article about Apple AI announcement       │
└─────────────────────────────────────────────────────────┘
```

### Step 2: Article ingested and extracted

```
┌─────────────────────────────────────────────────────────┐
│  Ingest Worker                                          │
│  - Downloads article HTML                              │
│  - Archives to: /tmp/ingest/apple-news-2024-0511.html │
│  - Extracts metadata:                                  │
│    - Title: "Apple Announces On-Device AI Features"   │
│    - Source: technews.site                            │
│    - Date: May 11, 2024                               │
│    - Summary: Apple unveiled AI capabilities...       │
│  - Registers metadata in Memory Worker                │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Extract Skill Agent                       │
│  - Task: "Extract competitive intelligence from        │
│    /tmp/ingest/apple-news-2024-0511.html"             │
│  - Context: Intent project-x focusing on Apple        │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Extract Worker                                         │
│  - Reads archived article                              │
│  - Extracts:                                          │
│    - Company: Apple Inc                                │
│    - Category: AI/artificial intelligence              │
│    - Key Points:                                      │
│      - On-device AI processing                        │
│      - Privacy-focused approach                       │
│      - Competing with Google/GitHub Copilot           │
│    - Market Impact: High (analyst reactions positive) │
│    - Relevance: Direct competitor to Google/Microsoft │
│  - Calls Memory Worker to store dossier:              │
│    ## Apple AI Initiative - May 11, 2024              │
│    Source: technews.site                              │
│    Summary: Apple unveiled on-device AI features...   │
│    Competitive Impact: High                           │
│    Our Response Options: [...]                        │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Intent: project-x                         │
│  - Notify: competitive_intelligence_extracted          │
│  - Intent logs: new_dossier_apple_ai                  │
│  - Intent updates:                                     │
│    - summary = "Apple AI announcement analyzed.        │
│      On-device AI, privacy focus. High competitive    │
│      impact. Dossier stored."                         │
│    - context.lastAnalysis = 'apple-ai-2024-0511'     │
└─────────────────────────────────────────────────────────┘
```

## Step 3: Team leader queries knowledge

```
From: team-leader@company.com
To: knowledge@company.com
Subject: Re: Apple tracking

What do we know about Apple's AI strategy?
```

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - User message: "What do we know about Apple's AI?"  │
│  - Intent Matching: project-x                         │
│  - Route to Intent: query                             │
│  - Intent receives query, prepares context            │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - Logs: knowledge_query                              │
│  - Prepares: Inject context into response             │
│    - Active Memory Workers: companies (Apple thread)  │
│    - Recent dossiers: apple-ai-2024-0511             │
│    - Key facts stored: ...                            │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Query Apple AI in companies thread"         │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (companies)                              │
│  - Reads: companies.md                                 │
│  - Finds Apple section                                 │
│  - Returns:                                            │
│    ## Apple Inc                                       │
│    ### AI Initiative - May 11, 2024                   │
│    Source: technews.site                              │
│    Summary: Apple unveiled on-device AI features...   │
│    Competitive Impact: High                           │
│    Our Response Options: [...]                        │
│    (plus earlier entries if any)                      │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Formats response with Intent context               │
│  - Intent logs: knowledge_provided                    │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Human Inbox (Team Leader)                              │
│  Subject: Re: Apple tracking                          │
│  Body:                                                 │
│  Apple's AI Strategy (as of May 11, 2024):           │
│  - On-device AI processing                            │
│  - Privacy-first approach                             │
│  - Competing with Google/GitHub Copilot               │
│  - Analyst reaction: Positive                         │
│  Competitive Impact: HIGH                            │
│  Options for Response: [...]                         │
│  [View Full Dossier] [Add Notes]                      │
└─────────────────────────────────────────────────────────┘
```

## Step 4: Team member adds competitor report

```
From: team-member@company.com
To: knowledge@company.com
Subject: Apple-Q2-earnings

Analyst report on Apple Q2 earnings attached.
```

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                             │
│  - Email with PDF attachment                           │
│  - Intent Matching: project-x                         │
│  - Route to Ingest Skill Agent                        │
│  - Notify Intent: earnings_report_received            │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Ingest Worker (pdf-handler)                           │
│  - Downloads PDF                                       │
│  - Archives to: /tmp/ingest/apple-q2-2024.pdf         │
│  - Extracts metadata:                                  │
│    - Type: Quarterly Earnings Report                  │
│    - Quarter: Q2 2024                                 │
│    - Company: Apple Inc                               │
│  - Registers in Memory                                │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Extract Worker                                         │
│  - Reads PDF                                           │
│  - Extracts:                                          │
│    - Revenue: $XX billion (+Y% YoY)                   │
│    - iPhone sales: ...                                │
│    - Services growth: ...                             │
│    - Forward guidance: ...                            │
│    - Analyst sentiment: Neutral/Positive/Negative     │
│  - Stores dossier                                     │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - Logs: earnings_analyzed                            │
│  - Summary: "Apple Q2 earnings: revenue +Y%.          │
│    Services strong. Forward guidance mixed."          │
│  - Context: { lastEarningsDate: '2024-Q2' }          │
└─────────────────────────────────────────────────────────┘
```

## Step 5: System suggests action based on intelligence

```
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - Analyzing: Apple AI strategy + Q2 earnings         │
│  - Pattern detected:                                   │
│    - Apple investing heavily in AI                    │
│    - Services growth放缓 (slowing)                    │
│    - Market opportunity: our product in AI space?     │
│  - Decision: Notify human of strategic insight        │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Human Inbox (Team Leader)                │
│  Subject: "Strategic Insight: Apple AI + Q2"          │
│  Body:                                                 │
│  Based on recent intelligence on Apple:               │
│  1. Apple's AI push suggests market is shifting       │
│  2. Services growth slowing may indicate...           │
│  3. Recommended action: [Review product strategy]    │
│     [Schedule team discussion] [Deep-dive analysis]  │
└─────────────────────────────────────────────────────────┘
```

## Step 6: Team discussion, decision recorded

```
From: team-leader@company.com
To: knowledge@company.com
Subject: Re: Strategic Insight: Apple AI + Q2

Let's schedule a product review. Moving our AI features
up by 2 weeks. Assigned to Product Team.
```

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Intent: project-x                         │
│  - Human decision received                             │
│  - Intent logs: strategic_decision_made                │
│  - Intent updates:                                     │
│    - summary = "Decision: accelerate AI features.     │
│      Product team assigned. Timeline moved up 2 weeks"│
│    - context.decisions.push({                         │
│        type: 'timeline_change',                        │
│        description: 'AI features moved up 2 weeks',   │
│        assignedTo: 'Product Team',                     │
│        timestamp: '2024-05-11'                         │
│      })                                                │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Dispatcher → Memory Skill Agent                        │
│  - Task: "Record decision: Project X AI features      │
│    timeline accelerated 2 weeks. Product Team owner." │
└─────────────────────────────────────────────────────────┘
|
v
┌─────────────────────────────────────────────────────────┐
│  Memory Worker (companies)                              │
│  - Appends to Apple section:                          │
│    ## Project X Decision - May 11, 2024               │
│    Strategic review concluded:                        │
│    - AI feature timeline: accelerated 2 weeks         │
│    - Owner: Product Team                              │
│    - Reason: competitive response to Apple AI push    │
└─────────────────────────────────────────────────────────┘
```

## Summary

| Event | Intent Updated | Skills Invoked |
|-------|---------------|----------------|
| Competitor tracking started | ✅ Created | Memory |
| News article ingested | ✅ | Ingest, Extract |
| Competitive intelligence extracted | ✅ | Extract, Memory |
| Knowledge query | ✅ | Memory |
| Earnings report ingested | ✅ | Ingest, Extract |
| Strategic decision recorded | ✅ | Memory |
| Action item tracked | ✅ | Memory |

## Final State

```
Intent: project-x
  Status: active
  Summary: "Ongoing Apple competitor tracking. 
    AI features timeline accelerated. Product Team assigned."
  Events: [
    tracking_started,
    news_article_received,
    competitive_intelligence_extracted,
    knowledge_query,
    earnings_report_received,
    strategic_decision_made,
    action_tracked
  ]
  Context: {
    focus: ['competitors', 'Apple', 'technology'],
    competitorTracking: true,
    decisions: [
      { type: 'timeline_change', 
        description: 'AI features moved up 2 weeks',
        assignedTo: 'Product Team' }
    ],
    relevantWorkers: ['companies-worker'],
    relevantSkills: ['memory', 'ingest', 'extract']
  }
```

## Key Pattern Demonstrated

1. **Long-running context**: Intent persists across weeks of tracking
2. **Incremental knowledge**: Each article/report adds to Apple dossier
3. **Strategic synthesis**: System can combine data points for insights
4. **Action tracking**: Decisions and assignments recorded in context
5. **Team collaboration**: Multiple team members contribute, one Intent tracks all

---

**Variations:**

### Multiple Competitors

```
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - Multiple Memory Workers:                           │
│    - companies (Apple thread)                         │
│    - companies (Google thread)                        │
│    - companies (Microsoft thread)                     │
│  - Cross-reference capability via Memory              │
└─────────────────────────────────────────────────────────┘
```

### Passive Monitoring (Background Ingest)

```
┌─────────────────────────────────────────────────────────┐
│  Intent: project-x                                     │
│  - Periodic checks: RSS feeds, news alerts            │
│  - Auto-ingest if Apple mentioned                     │
│  - Human notified only if significant event           │
└─────────────────────────────────────────────────────────┘
```
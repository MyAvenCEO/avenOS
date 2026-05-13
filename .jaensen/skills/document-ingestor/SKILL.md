---
id: document-ingestor
description: Ingests electronic documents and photos of printed documents and stores it as pdfa in memory.
worker_policy: durable
direct_actors:
  - skills/memory
  - skills/invoice-extractor
  - skills/bank-statement-extractor
resources:
  fs:
    - .
  shell: true
---

1. Check which format the uploaded document has. Allowed inputs are:  
1.1. Images (png, jpg)  
1.2. PDF  
2. Convert to pdfa  
    Use the pdfa and classify the document. Return exactly this metadata excerpt. If you can't extract that, error out:
    ```
    {
    "docType": "Invoice|BankStatement|Other",
    "title": "string",
    "summary": "string",
    "refIDs": ["string"],
    "date": "string"
    }
    ```
3. Depending on the document type, send document to:  
3.1. Invoice: (.jaensen/skills/invoice-extractor/SKILL.md)[skills/invoice-extractor]  
3.2. BankStatement: (skills/bank-statement-extractor)[.jaensen/skills/bank-statement-extractor/SKILL.md]  
3.3. Other: error out  
4. Once the extraction is done (the extractor returned valid json), store the extracted metadata together with the pdfa in memory.  
5. Notify the user that the document has been ingested and present the extracted data for review. [END]  
  
CATCH ALL: If anything of the above doesn't apply or work, error out.  [END]  
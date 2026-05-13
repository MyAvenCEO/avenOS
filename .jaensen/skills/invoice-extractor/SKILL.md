---
id: invoice-extractor
description: Extracts a clearly defined set of information (defined by json-schema) from an invoice for further processing or memory. Doesn't store the information on its own, but just returns it as json.
worker_policy: durable
resources:
  fs:
    - .
  shell: true
---

Read the incoming invoice and extract all information that is required by the following json-schema.
If the field is not optional, and you can't find it, fail the skill.
Return the extracted information as a json object to the caller.

Here's the json-schema:
```jsonschema
{
  "id": "invoice",
  "name": "Invoice",
  "description": "Payment requests: invoices, bills, receipts, and payment reminders. **Header** (`header`: identifiers, dates, **currency**), **totals** (net, tax, gross), and **`payments`** at document root. `statements[]` — line tables only. **`total_outstanding`** vs **`totals.invoice_total`** and **payments**.",
  "merge_spec": {
    "strategy": "invoice"
  },
  "llm_model": null,
  "system_prompt": "**Body-only tool** — Do not output `vendor` or `buyer` (the parties pipeline provides them). Fill **`header`** (`document_kind`, **currency**, `invoice_number`, `order_number`, `customer_number`, dates, `referenced_invoice_numbers`, **`reference_entries`** for extra labeled IDs), **`totals`**, **`payments`** (all paid amounts — no separate roll-up field), `total_outstanding`, `statements` (line content only), `payment_instructions`, and every other schema field.\n\n**Root vs statements** — Put identifiers and **currency** under **`header`**. Put **`totals`** and **`payments`** on the root. Use **`statements[0].line_items`** (or **`line_groups`**) **only** for position tables.\n\n**`header.reference_entries`** — For lines like **Abrechnungsnummer**, **Gläubiger-ID**, **Ihre Referenz**, **Einlieferungszeitraum**, **Genutztes Versandprodukt**, **Blatt-/ICR-Nummern**: one **`{kind,label,value}`** per row; **`kind`** = normalized key; **`label`** = printed heading; **`value`** = text/RFC as shown. Prefer **`creditor_identifier`** for *Gläubiger-ID*, **`billing_number`** for *Abrechnungsnummer*, **`carrier_product_service`** for product lines, **`your_reference`** for *Ihre Referenz*, **`sheet_batch_or_icr_range`** for numbered sheet ranges.\n\n**MwSt table** — **`totals.tax_breakdown`**: one object per rate with **`tax_rate_percent`** + **`tax_amount`**. Set **`totals.tax_total`** when a single tax sum is printed.\n\n**Service / billing periods** — Per **`statements[]`** block use **`service_period_normalized`** (**YYYY-MM-DD** range or month/quarter fields) when a **Leistungszeitraum** is shown; keep **`service_period`** verbatim. For **`line_groups`**, fill **`context_period_normalized** similarly. **Positions (`line_items` / `line_groups.rows`)** — **`title`** vs **`description`**: put the headline or first printed line in **`title`** when indented **a.**/**b.** (or bullets) continue below; put **only** those sub-lines in **`description`**. Never repeat **`title`** text inside **`description`**. Use newline-separated text in **`description`** for multi-line sub-blocks. Prefer **`description`** only (**`title`** null) when there are no indented continuations. Set **`quantity_unit`** (verbatim) and optional **`quantity_measure`**. **Vendor / SEPA** — Use **`vendor.banking_accounts`** for each creditor block (IBAN/BIC + **`creditor_identifier`** when shown); for Lastschrift/Bankeinzug use **`purpose`** `direct_debit_collection` and fill **`sepa_mandate_reference`** (*Mandat*…). Put the debtor account printed for the debit (*von Ihrem Konto*, IBAN/BIC, bank name) in **`buyer.banking_accounts`** with **`purpose`** `sepa_debit_debtor`. Prefer **`header.reference_entries`** rows (`creditor_identifier`, `sepa_mandate_reference`) for labeled Gläubiger-ID/Mandat lines. **`payment_instructions`** may stay as verbatim prose. Use **`org_public_record`** for imprint: **locations**, **identifiers**, **contact_channels**, **officer_groups**.\n\n**Issue date** — **`header.issue_date`** is **Rechnungsdatum** when printed.\n\n**Payments** — Use **`payments[]` only** for every amount received (itemized or one summary row).\n\n**Totals reconciliation** — **`totals.invoice_total`** and **`total_outstanding`** vs sum of **`payments`**.",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "vendor",
      "buyer",
      "header",
      "statements"
    ],
    "properties": {
      "header": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "document_kind"
        ],
        "description": "Document header row: invoice identifiers, billing dates, ISO currency, and kind. Keep these fields together; do not duplicate them under `statements`.",
        "properties": {
          "document_kind": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "invoice",
              "payment_reminder",
              "consolidated_reminder",
              "credit_note",
              "receipt",
              "other",
              null
            ],
            "description": "Invoice sub-type. Required. Choose the single best fit."
          },
          "letter_date": {
            "type": [
              "string",
              "null"
            ],
            "description": "Date on the letter or cover. YYYY-MM-DD if unambiguous."
          },
          "due_date": {
            "type": [
              "string",
              "null"
            ],
            "description": "Payment due date if stated for the document."
          },
          "referenced_invoice_numbers": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Invoice or statement identifiers listed in the header — one string per number, never comma-merged."
          },
          "issue_date": {
            "type": [
              "string",
              "null"
            ],
            "description": "**Invoice / Rechnungs** issue date when printed (Rechnungsdatum, Ausstellungsdatum). YYYY-MM-DD. Not the service/billing period alone."
          },
          "invoice_number": {
            "type": [
              "string",
              "null"
            ],
            "description": "**Primary** invoice or Rechnungsnummer at **document root** (not under `statements`)."
          },
          "order_number": {
            "type": [
              "string",
              "null"
            ],
            "description": "**Order / Auftrag / Bestell** reference when distinct from the invoice #. Root field."
          },
          "customer_number": {
            "type": [
              "string",
              "null"
            ],
            "description": "**Printed customer / debtor account** at the issuer (Kunden-Nr., Kundennummer). Use **`reference_entries`** for carrier-specific **`Abrechnungsnummer`** and other labeled IDs that are not your generic Kunden-Nr.; do not stuff composite billing IDs into **`customer_number`**."
          },
          "reference_entries": {
            "type": "array",
            "description": "Structured **labeled header references** beyond one-line scalars (**`invoice_number`**, **`order_number`**, …). One row per printed label/value (DRY schema, same shape for shipment, creditor, billing, batch, period). Omit empty rows.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind",
                "value"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "description": "**Normalized category** for filtering and dashboards; use printed **`label`** for exact wording.",
                  "enum": [
                    "creditor_identifier",
                    "billing_number",
                    "customer_identifier",
                    "order_reference",
                    "your_reference",
                    "vendor_internal_reference",
                    "sheet_batch_or_icr_range",
                    "carrier_product_service",
                    "delivery_pickup_period",
                    "party_name_and_address_note",
                    "sepa_mandate_reference",
                    "payment_scheme_identifier",
                    "other"
                  ]
                },
                "sub_kind": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Optional finer discriminator (SEPA Creditor-ID vs IBAN creditor, tariff name, tariff code)."
                },
                "label": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "**Verbatim** printed caption (e.g. *Abrechnungsnummer*, *Gläubiger-ID*, *Ihre Referenz*, *Einlieferungszeitraum*)."
                },
                "value": {
                  "type": "string",
                  "description": "Primary identifier or free-text value as printed."
                },
                "value_end": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "**Optional.** End of a range (e.g. second sheet **248**) or ISO **YYYY-MM-DD** end date when **`value`** is the start (`value` / **`value_end`** should not duplicate a single fused string)."
                }
              }
            },
            "default": []
          },
          "currency": {
            "type": [
              "string",
              "null"
            ],
            "description": "ISO 4217 code (EUR, USD, …)."
          }
        }
      },
      "vendor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name"
        ],
        "properties": {
          "identity_id": {
            "type": [
              "string",
              "null"
            ],
            "description": "Resolved identity UUID from the party pipeline (for UI); not printed on the source document."
          },
          "name": {
            "type": [
              "string",
              "null"
            ],
            "description": "Legal entity name only (the contracting party), not a combined string with a contact person on the same line — use **contact** fields for a named representative."
          },
          "contact_name": {
            "type": [
              "string",
              "null"
            ],
            "description": "Ansprechpartner / contact person (natural person) when the document lists them next to the company; keep **name** to the company only."
          },
          "contact_identity_id": {
            "type": [
              "string",
              "null"
            ],
            "description": "UUID of a **person** identity when the contact is stored separately (from party step `vendor_representative`); links in the Identities view."
          },
          "street": {
            "type": [
              "string",
              "null"
            ],
            "description": "Street line only."
          },
          "postal_code": {
            "type": [
              "string",
              "null"
            ]
          },
          "city": {
            "type": [
              "string",
              "null"
            ]
          },
          "country": {
            "type": [
              "string",
              "null"
            ],
            "description": "Full country name in English (e.g. Germany, United States) — not a two-letter code. If the document shows a code, expand to the name."
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "phone": {
            "type": [
              "string",
              "null"
            ]
          },
          "tax_id": {
            "type": [
              "string",
              "null"
            ]
          },
          "bank": {
            "type": [
              "object",
              "null"
            ],
            "additionalProperties": false,
            "description": "Single **creditor bank** block; prefer **`banking_accounts`** when multiple IBANs or SEPA blocks appear — you may mirror the primary row here.",
            "properties": {
              "bank_name": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Bank or branch name as printed."
              },
              "iban": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "International Bank Account Number."
              },
              "bic": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Bank Identifier Code (SWIFT/BIC)."
              }
            }
          },
          "banking_accounts": {
            "type": "array",
            "description": "**All printed bank / SEPA payment blocks** for the issuer (e.g. *Kontoverbindung*, separate direct-debit account). Prefer over a lone **`bank`** when more than one IBAN or when **Gläubiger-ID** is tied to collections. Omit or `[]` if absent.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "purpose": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Why this block exists when distinguishable.",
                  "enum": [
                    "payment_reception",
                    "direct_debit_collection",
                    "salary_or_internal",
                    "other",
                    null
                  ]
                },
                "label_printed": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Section heading as printed (*Kontoverbindung*, *Bankverbindung*)."
                },
                "bank_name": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "iban": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "bic": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "creditor_identifier": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "**SEPA Creditor identifier** (e.g. *Gläubiger-ID*) printed with or next to this account / mandate block."
                },
                "sepa_mandate_reference": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "**SEPA mandate reference** (*Mandatsreferenz*, e.g. *Mandat* BOE…) when shown with Lastschrift / Bankeinzug for this creditor block."
                }
              }
            },
            "default": []
          },
          "org_public_record": {
            "type": [
              "object",
              "null"
            ],
            "description": "Generic **imprint / legal disclosure** for the **vendor** (register seats, HRB, VAT, extra addresses, board lists, extra web/email/phone lines) — not the primary letterhead address (that stays on root **street** / **city** fields).",
            "additionalProperties": false,
            "properties": {
              "locations": {
                "type": "array",
                "description": "Additional structured addresses (billing office, registered seat, branch, *Abrechnungsstelle*, *Hausadresse*).",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "role"
                  ],
                  "properties": {
                    "role": {
                      "type": "string",
                      "enum": [
                        "principal_trading",
                        "billing_service",
                        "registered_seat",
                        "branch",
                        "returns_or_correspondence",
                        "other"
                      ],
                      "description": "Abstract role of this address block."
                    },
                    "heading_printed": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "Verbatim printed heading above the address."
                    },
                    "organization_name": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "Legal name line if it differs from the main **vendor.name** (e.g. parent *Deutsche Post AG* vs *DHL Paket GmbH*)."
                    },
                    "street": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "postal_code": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "city": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "country": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "Full English country name when known."
                    }
                  }
                }
              },
              "identifiers": {
                "type": "array",
                "description": "Registers, VAT, national tax numbers, chamber IDs — one object per printed line.",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "value"
                  ],
                  "properties": {
                    "category": {
                      "type": "string",
                      "enum": [
                        "commercial_register",
                        "vat_id",
                        "national_tax_number",
                        "trade_chamber",
                        "court_filing",
                        "other"
                      ]
                    },
                    "issuer": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "Register court, city, or authority (*Registergericht Bonn*)."
                    },
                    "value": {
                      "type": "string",
                      "description": "The identifier string (HRB…, USt-IdNr., …)."
                    },
                    "label_printed": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "Caption as printed (*USt-IdNr.*, *St.Nr.*, *HRB*)."
                    }
                  }
                }
              },
              "contact_channels": {
                "type": "array",
                "description": "Extra contact lines beyond the main **email** / **phone** (e.g. imprint *www.*, billing fax).",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "channel",
                    "value"
                  ],
                  "properties": {
                    "channel": {
                      "type": "string",
                      "enum": [
                        "website",
                        "email",
                        "phone",
                        "fax",
                        "other"
                      ]
                    },
                    "value": {
                      "type": "string"
                    }
                  }
                }
              },
              "officer_groups": {
                "type": "array",
                "description": "Management / board / supervisory lists when printed as named groups.",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "group_kind": {
                      "type": "string",
                      "enum": [
                        "executives",
                        "board",
                        "supervisory_board",
                        "other"
                      ]
                    },
                    "heading_printed": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "e.g. *Geschäftsführung*, *Vorstand*."
                    },
                    "names": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "buyer": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name"
        ],
        "properties": {
          "identity_id": {
            "type": [
              "string",
              "null"
            ],
            "description": "Resolved identity UUID from the party pipeline (for UI); not printed on the source document."
          },
          "name": {
            "type": [
              "string",
              "null"
            ],
            "description": "Customer / bill-to **company or legal name** only — not a merged \"Name, Company\" string; the named individual belongs in **contact** fields and may be a separate `buyer_representative` identity."
          },
          "contact_name": {
            "type": [
              "string",
              "null"
            ],
            "description": "Ansprechpartner / contact or representative (person) for this bill-to, when shown separately on the document."
          },
          "contact_identity_id": {
            "type": [
              "string",
              "null"
            ],
            "description": "UUID of a **person** identity for the contact (from party step `buyer_representative`)."
          },
          "street": {
            "type": [
              "string",
              "null"
            ]
          },
          "postal_code": {
            "type": [
              "string",
              "null"
            ]
          },
          "city": {
            "type": [
              "string",
              "null"
            ]
          },
          "country": {
            "type": [
              "string",
              "null"
            ],
            "description": "Full country name in English (e.g. Germany, United States) — not a two-letter code. If the document shows a code, expand to the name."
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "phone": {
            "type": [
              "string",
              "null"
            ]
          },
          "tax_id": {
            "type": [
              "string",
              "null"
            ]
          },
          "banking_accounts": {
            "type": "array",
            "description": "**Printed debtor / buyer bank rows** especially for **SEPA direct debit** (*Lastschrift*, *von Ihrem Konto*): IBAN/BIC/**bank_name** of the account **to be debited** — not the creditor’s receipt account (that stays under **`vendor.banking_accounts`**). Omit `[]` if absent.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "purpose": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Why this block exists when distinguishable.",
                  "enum": [
                    "sepa_debit_debtor",
                    "payment_credit",
                    "other",
                    null
                  ]
                },
                "label_printed": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Section heading as printed if any."
                },
                "bank_name": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "iban": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "bic": {
                  "type": [
                    "string",
                    "null"
                  ]
                }
              }
            },
            "default": []
          }
        }
      },
      "payment_instructions": {
        "type": [
          "string",
          "null"
        ],
        "description": "Verbatim **payment / bank prose** when useful; **also** fill **`vendor.banking_accounts`**, **`buyer.banking_accounts`**, and **`header.reference_entries`** for *Gläubiger-ID* / *Mandat* so data is not only buried here."
      },
      "totals": {
        "type": [
          "object",
          "null"
        ],
        "description": "Consolidated document-level money roll-ups: net subtotal, VAT by rate, tax sum, and gross total.",
        "additionalProperties": false,
        "properties": {
          "subtotal": {
            "type": [
              "number",
              "null"
            ],
            "description": "Net subtotal (Zwischensumme / net before tax) for the **whole document** when one line is printed."
          },
          "tax_breakdown": {
            "type": "array",
            "description": "When the document prints a **tax summary by rate** (e.g. *MwSt Gruppe* *A 19%* / *B 7%*, or columns *USt. %* + net + tax + gross), one object per **distinct** rate. Omit the array only if there is no per-rate table. Each row must give the **numeric** rate in `tax_rate_percent` (not only a letter).",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "tax_rate_percent",
                "tax_amount"
              ],
              "properties": {
                "tax_rate_percent": {
                  "type": "number",
                  "description": "**Required.** VAT / MwSt rate as a number (0–100) exactly as in the tax summary (e.g. 19, 7, 0).",
                  "minimum": 0,
                  "maximum": 100
                },
                "tax_group_letter": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Optional letter in *MwSt Gruppe* (e.g. *A* on the same line as *19%*).",
                  "maxLength": 2
                },
                "tax_rate_text": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Optional verbatim label; `tax_rate_percent` remains the source of truth."
                },
                "net_subtotal": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "Net / taxable base for this rate in document currency (e.g. Zwischensumme ohne USt.)."
                },
                "tax_amount": {
                  "type": "number",
                  "description": "**Required** when the table shows a MwSt / VAT amount for this rate."
                },
                "gross_subtotal": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "Gross for this rate if printed (optional; often derivable as net + tax)."
                }
              }
            }
          },
          "tax_total": {
            "type": [
              "number",
              "null"
            ],
            "description": "Total VAT / MwSt summed when a single roll-up is printed. **Whenever** the footer shows tax **by rate**, fill **`totals.tax_breakdown`** with one object per rate: **`tax_rate_percent`** (number 0–100) **and** **`tax_amount`** — never only a lump sum without per-rate rows when the table lists *MwSt 19%* + amount."
          },
          "invoice_total": {
            "type": [
              "number",
              "null"
            ],
            "description": "**Gross** document total (Brutto / Gesamtwert) before paid/outstanding split."
          }
        }
      },
      "payments": {
        "type": "array",
        "description": "**All payments** toward this invoice — card/EC lines, transfers, or a **single roll-up row** when only a total paid is printed (same shape: `amount`, optional `date` / `method` / `reference`). Do **not** emit a separate scalar for amount paid. **No payments:** `[]`.",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "amount"
          ],
          "properties": {
            "date": {
              "type": [
                "string",
                "null"
              ],
              "description": "Payment date if printed."
            },
            "amount": {
              "type": [
                "number",
                "null"
              ]
            },
            "method": {
              "type": [
                "string",
                "null"
              ],
              "description": "e.g. 'Überweisung', 'Lastschrift', 'Bar'."
            },
            "reference": {
              "type": [
                "string",
                "null"
              ],
              "description": "Reference / Verwendungszweck if given."
            }
          }
        }
      },
      "total_outstanding": {
        "type": [
          "number",
          "null"
        ],
        "description": "Document-level **amount still due** after payments. **Unpaid / open:** printed balance due, or **`totals.invoice_total`** if nothing paid yet. **Paid in full:** `0`. **Partial:** remaining balance vs **`totals.invoice_total`** minus the **sum of `payments[].amount`** when those figures appear."
      },
      "statements": {
        "type": "array",
        "minItems": 1,
        "description": "Each separately headed or separately totaled billing block. Assign line items only to the block they appear under in the markdown.",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "line_items"
          ],
          "properties": {
            "section_title": {
              "type": [
                "string",
                "null"
              ],
              "description": "Section heading as printed above this block."
            },
            "service_period": {
              "type": [
                "string",
                "null"
              ],
              "description": "Verbatim service / billing period line as printed (any language/format). Prefer also filling **service_period_normalized** with ISO dates when inferable."
            },
            "line_items": {
              "type": "array",
              "minItems": 0,
              "description": "Flat list of itemized rows (use for simple tables). If you use `line_groups` for tiered/SaaS usage, set to `[]` to avoid duplicating the same lines. **`title`** and **`description`** must not duplicate the same headline — see field descriptions.",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "description",
                  "amount"
                ],
                "properties": {
                  "title": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Main position headline when the source visually splits it from **indented sub-lines** (e.g. **a.**/**b.**, bullets under **1.**). Put **only** that headline here (product + period if it sits on the same main line). Use `null` if the row is one unbroken string — then put everything in **`description`**. **Must not** be repeated verbatim inside **`description`**."
                  },
                  "description": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Detail text **only**: indented sub-lines, fine print, refs — concatenate **multiline** blocks with **`\\n`** (or **`; `** if the PDF wraps one conceptual block). When **`title`** is set, **do not** echo **`title`** or repeat the headline here; include sub-lines (**a.** *Abrufe …*, **b.** *Weiterleitung …*) entirely. When **`title`** is null, carry the **full** line text here."
                  },
                  "line_kind": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "enum": [
                      "detail",
                      "discount",
                      "subtotal",
                      "header_amount",
                      "note",
                      "other",
                      null
                    ],
                    "description": "Row role when the source distinguishes it (e.g. discount lines). Omitted for normal lines."
                  },
                  "quantity": {
                    "type": [
                      "number",
                      "null"
                    ],
                    "description": "**Anzahl / Menge** numeric quantity only (no unit string)."
                  },
                  "quantity_unit": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "**Einheit verbatim** from the document (ST, Std., kg, Palette, …) — preserve odd spellings."
                  },
                  "quantity_measure": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "enum": [
                      null,
                      "count_each_piece",
                      "count_pair",
                      "count_dozen",
                      "count_gross",
                      "count_set",
                      "pack_inner_pack",
                      "pack_carton_case_box",
                      "pack_crate_export",
                      "pack_pallet",
                      "pack_skid_platform",
                      "pack_bundle_lot_batch",
                      "pack_roll_coil_reel",
                      "pack_sheet_flat",
                      "pack_drum_barrel_keg",
                      "pack_container_load",
                      "mass_microgram",
                      "mass_milligram",
                      "mass_gram",
                      "mass_kilogram",
                      "mass_metric_tonne",
                      "mass_pound",
                      "mass_ounce",
                      "length_millimeter",
                      "length_centimeter",
                      "length_meter",
                      "length_kilometer",
                      "length_inch",
                      "length_foot",
                      "length_yard",
                      "length_mile",
                      "area_square_millimeter",
                      "area_square_centimeter",
                      "area_square_meter",
                      "area_square_kilometer",
                      "area_square_inch",
                      "area_square_foot",
                      "area_square_yard",
                      "area_hectare",
                      "area_acre",
                      "volume_cubic_millimeter",
                      "volume_cubic_centimeter",
                      "volume_cubic_meter",
                      "volume_microliter",
                      "volume_milliliter",
                      "volume_liter",
                      "volume_hectoliter",
                      "volume_us_liquid_gallon",
                      "volume_us_fluid_quart",
                      "volume_us_fluid_ounce",
                      "volume_imperial_gallon",
                      "volume_imperial_fluid_ounce",
                      "time_second",
                      "time_minute",
                      "time_hour",
                      "time_day_calendar",
                      "time_week_calendar",
                      "time_month_calendar",
                      "time_year_calendar",
                      "energy_joule",
                      "energy_kilojoule",
                      "energy_megajoule",
                      "energy_watt_hour",
                      "energy_kilowatt_hour",
                      "energy_megawatt_hour",
                      "power_kilowatt",
                      "digital_data_byte",
                      "digital_data_kilobyte",
                      "digital_data_megabyte",
                      "digital_data_gigabyte",
                      "digital_data_terabyte",
                      "telecom_voice_minute",
                      "telecom_sms_each",
                      "telecom_data_megabyte",
                      "freight_shipment_each",
                      "freight_delivery_stop_each",
                      "freight_loading_meter",
                      "service_license_seat_each",
                      "service_user_account_each",
                      "service_subscription_period",
                      "service_flat_charge_once",
                      "labor_staff_hour",
                      "labor_machine_hour",
                      "unknown_or_ambiguous_unit",
                      "other_invoice_line_unit"
                    ],
                    "description": "**English-standard normalized unit family** (SI / IEC where applicable; US customary/imperial gallon where Anglophone invoicing prints them — still store **quantity_unit** verbatim). Map from the ME column when clear; otherwise null or **`other_invoice_line_unit`**."
                  },
                  "unit_price": {
                    "type": [
                      "number",
                      "null"
                    ],
                    "description": "**Einzelpreis** / unit price before line VAT; column *Einzelpreis* / unit when present; paired with **`amount`** (Zeilen-Gesamt / line total)."
                  },
                  "tax_rate_percent": {
                    "type": [
                      "number",
                      "null"
                    ],
                    "description": "VAT / MwSt rate as a **number** (e.g. 19, 7, 0) from the line or from the MwSt summary row that matches a letter on the line. Required whenever a rate is identifiable; null only if the line has no tax indication.",
                    "minimum": 0,
                    "maximum": 100
                  },
                  "tax_group_letter": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Single-letter **POS / MwSt group** (e.g. *A*, *B*) when printed on the line; always pair with `tax_rate_percent` from the receipt’s tax summary table (e.g. *A* → 19, *B* → 7 in DE).",
                    "maxLength": 2
                  },
                  "tax_rate_text": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Verbatim tax fragment when useful (*MwSt 19%*, *reduced*). **Does not** replace `tax_rate_percent`."
                  },
                  "amount": {
                    "type": [
                      "number",
                      "null"
                    ],
                    "description": "Line amount as printed."
                  },
                  "position": {
                    "type": [
                      "string",
                      "number",
                      "null"
                    ],
                    "description": "**Pos.** column / position label when printed (e.g. 10, 20, 40 rub-64b)."
                  },
                  "article_number": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "**Artikel-Nr.** / supplier article code (Artikelnummer) when in its own column."
                  }
                }
              }
            },
            "line_groups": {
              "type": "array",
              "minItems": 0,
              "description": "Grouped line items by **position / category** (SaaS usage, usage tables). Each group is one printed block: **title** and optional **context** (period) are separate; **rows** are the detail lines only.",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "rows"
                ],
                "properties": {
                  "title": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Category / position name only (e.g. Compute Hours, Egress GB). Do not put the date range here."
                  },
                  "context": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Verbatim subline (period / caption) under the **title**. Prefer also **context_period_normalized** with ISO dates when inferable (same shape as **service_period_normalized**)."
                  },
                  "rows": {
                    "type": "array",
                    "minItems": 0,
                    "description": "Detail lines in this block (resources, discounts, subtotals as printed).",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "description",
                        "amount"
                      ],
                      "properties": {
                        "title": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "description": "Primary cell label when the table splits headline vs detail (tier, SKU line). **`description`** must not repeat this text. `null` if one string only — put all of it in **`description`**."
                        },
                        "description": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "description": "Remainder only when **`title`** is set; **multiline** sub-rows allowed (**`\\n`**). Never duplicate **`title`**; if **`title`** is null, full row text."
                        },
                        "line_kind": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "enum": [
                            "detail",
                            "discount",
                            "subtotal",
                            "header_amount",
                            "note",
                            "other",
                            null
                          ],
                          "description": "discount / subtotal / detail as in the source table."
                        },
                        "quantity": {
                          "type": [
                            "number",
                            "null"
                          ],
                          "description": "**Anzahl / Menge** numeric quantity only (no unit string)."
                        },
                        "quantity_unit": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "description": "**Einheit verbatim** from the document (ST, Std., kg, Palette, …)."
                        },
                        "quantity_measure": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "enum": [
                            null,
                            "count_each_piece",
                            "count_pair",
                            "count_dozen",
                            "count_gross",
                            "count_set",
                            "pack_inner_pack",
                            "pack_carton_case_box",
                            "pack_crate_export",
                            "pack_pallet",
                            "pack_skid_platform",
                            "pack_bundle_lot_batch",
                            "pack_roll_coil_reel",
                            "pack_sheet_flat",
                            "pack_drum_barrel_keg",
                            "pack_container_load",
                            "mass_microgram",
                            "mass_milligram",
                            "mass_gram",
                            "mass_kilogram",
                            "mass_metric_tonne",
                            "mass_pound",
                            "mass_ounce",
                            "length_millimeter",
                            "length_centimeter",
                            "length_meter",
                            "length_kilometer",
                            "length_inch",
                            "length_foot",
                            "length_yard",
                            "length_mile",
                            "area_square_millimeter",
                            "area_square_centimeter",
                            "area_square_meter",
                            "area_square_kilometer",
                            "area_square_inch",
                            "area_square_foot",
                            "area_square_yard",
                            "area_hectare",
                            "area_acre",
                            "volume_cubic_millimeter",
                            "volume_cubic_centimeter",
                            "volume_cubic_meter",
                            "volume_microliter",
                            "volume_milliliter",
                            "volume_liter",
                            "volume_hectoliter",
                            "volume_us_liquid_gallon",
                            "volume_us_fluid_quart",
                            "volume_us_fluid_ounce",
                            "volume_imperial_gallon",
                            "volume_imperial_fluid_ounce",
                            "time_second",
                            "time_minute",
                            "time_hour",
                            "time_day_calendar",
                            "time_week_calendar",
                            "time_month_calendar",
                            "time_year_calendar",
                            "energy_joule",
                            "energy_kilojoule",
                            "energy_megajoule",
                            "energy_watt_hour",
                            "energy_kilowatt_hour",
                            "energy_megawatt_hour",
                            "power_kilowatt",
                            "digital_data_byte",
                            "digital_data_kilobyte",
                            "digital_data_megabyte",
                            "digital_data_gigabyte",
                            "digital_data_terabyte",
                            "telecom_voice_minute",
                            "telecom_sms_each",
                            "telecom_data_megabyte",
                            "freight_shipment_each",
                            "freight_delivery_stop_each",
                            "freight_loading_meter",
                            "service_license_seat_each",
                            "service_user_account_each",
                            "service_subscription_period",
                            "service_flat_charge_once",
                            "labor_staff_hour",
                            "labor_machine_hour",
                            "unknown_or_ambiguous_unit",
                            "other_invoice_line_unit"
                          ],
                          "description": "**English-standard normalized unit family** (SI / IEC where applicable; US customary/imperial gallon where Anglophone invoicing prints them — still store **quantity_unit** verbatim). Map from the ME column when clear; otherwise null or **`other_invoice_line_unit`**."
                        },
                        "unit_price": {
                          "type": [
                            "number",
                            "null"
                          ],
                          "description": "**Einzelpreis** / unit price before line VAT; column *Einzelpreis* / unit when present; paired with **`amount`** (Zeilen-Gesamt / line total)."
                        },
                        "tax_rate_percent": {
                          "type": [
                            "number",
                            "null"
                          ],
                          "description": "Per-row MwSt / VAT as a **number**; if only a group letter is printed, take the % from the receipt’s MwSt summary. minimum 0, maximum 100.",
                          "minimum": 0,
                          "maximum": 100
                        },
                        "tax_group_letter": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "description": "Single letter on the line (*A*/*B*) with `tax_rate_percent` from the matching *MwSt Gruppe* row.",
                          "maxLength": 2
                        },
                        "tax_rate_text": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "description": "Verbatim label if needed; does not replace `tax_rate_percent`."
                        },
                        "amount": {
                          "type": [
                            "number",
                            "null"
                          ],
                          "description": "Line amount as printed."
                        },
                        "position": {
                          "type": [
                            "string",
                            "number",
                            "null"
                          ],
                          "description": "**Pos.** column / position label when printed (e.g. 10, 20, 40 rub-64b)."
                        },
                        "article_number": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "description": "**Artikel-Nr.** / supplier article code (Artikelnummer) when in its own column."
                        }
                      }
                    }
                  },
                  "context_period_normalized": {
                    "type": [
                      "object",
                      "null"
                    ],
                    "additionalProperties": false,
                    "description": "Normalized **billing / service period** for analytics and sorting. Use **ISO 8601** **start_date** / **end_date** (**YYYY-MM-DD**, inclusive) when the source gives explicit dates. For **month-only** captions (**10.2025**, **Oct 2025**, **MM/YYYY**), set **calendar_year** and **calendar_month** and, when unambiguous, **start_date**/**end_date** as the **first** and **last** calendar day of that month unless the invoice states narrower limits. For **quarterly** captions (**Q3 2025**), use **calendar_year**, **calendar_quarter**, and derived **start_date**/**end_date** when you can infer standard Gregorian quarters. Omit or null when the document only gives non-parseable prose — rely on the verbatim **context** / **service_period** strings then.",
                    "properties": {
                      "start_date": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "description": "Inclusive interval start (**YYYY-MM-DD**).",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      },
                      "end_date": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "description": "Inclusive interval end (**YYYY-MM-DD**).",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      },
                      "calendar_year": {
                        "type": [
                          "integer",
                          "null"
                        ],
                        "minimum": 1900,
                        "maximum": 2200,
                        "description": "Gregorian **year** when the period is year- or quarter- or month-bounded."
                      },
                      "calendar_month": {
                        "type": [
                          "integer",
                          "null"
                        ],
                        "minimum": 1,
                        "maximum": 12,
                        "description": "**1–12** month when caption is month precision without explicit day span."
                      },
                      "calendar_quarter": {
                        "type": [
                          "integer",
                          "null"
                        ],
                        "minimum": 1,
                        "maximum": 4,
                        "description": "**1–4** quarter when caption is quarterly."
                      }
                    }
                  }
                }
              }
            },
            "service_period_normalized": {
              "type": [
                "object",
                "null"
              ],
              "additionalProperties": false,
              "description": "Normalized **billing / service period** for analytics and sorting. Use **ISO 8601** **start_date** / **end_date** (**YYYY-MM-DD**, inclusive) when the source gives explicit dates. For **month-only** captions (**10.2025**, **Oct 2025**, **MM/YYYY**), set **calendar_year** and **calendar_month** and, when unambiguous, **start_date**/**end_date** as the **first** and **last** calendar day of that month unless the invoice states narrower limits. For **quarterly** captions (**Q3 2025**), use **calendar_year**, **calendar_quarter**, and derived **start_date**/**end_date** when you can infer standard Gregorian quarters. Omit or null when the document only gives non-parseable prose — rely on the verbatim **service_period**/**context** strings then.",
              "properties": {
                "start_date": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Inclusive interval start (**YYYY-MM-DD**).",
                  "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                },
                "end_date": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Inclusive interval end (**YYYY-MM-DD**).",
                  "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                },
                "calendar_year": {
                  "type": [
                    "integer",
                    "null"
                  ],
                  "minimum": 1900,
                  "maximum": 2200,
                  "description": "Gregorian **year** when the period is year- or quarter- or month-bounded."
                },
                "calendar_month": {
                  "type": [
                    "integer",
                    "null"
                  ],
                  "minimum": 1,
                  "maximum": 12,
                  "description": "**1–12** month when caption is month precision without explicit day span."
                },
                "calendar_quarter": {
                  "type": [
                    "integer",
                    "null"
                  ],
                  "minimum": 1,
                  "maximum": 4,
                  "description": "**1–4** quarter when caption is quarterly."
                }
              }
            }
          }
        }
      }
    }
  }
}
```
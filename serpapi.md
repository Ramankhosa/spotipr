# SerpApi Google Patents API Structure

## Overview
SerpApi provides access to Google Patents data through their API, allowing programmatic search and retrieval of patent information.

## Main API Endpoints

### 1. Google Patents Search API
**Purpose**: Search for patents using various query parameters
**Base URL**: `https://serpapi.com/search.json?engine=google_patents`

#### Key Parameters:
- `q`: Search query (e.g., "(Coffee)" for coffee-related patents)
- `page`: Pagination parameter
- Other standard SerpApi parameters (API key, etc.)

#### Response Structure:
```json
{
  "organic_results": [
    {
      "position": number,
      "rank": number,
      "patent_id": "patent/{PATENT_ID}/en",
      "patent_link": "https://patents.google.com/patent/{PATENT_ID}/en",
      "serpapi_link": "https://serpapi.com/search.json?engine=google_patents_details&patent_id=...",
      "title": "Patent title",
      "snippet": "Brief description of patent claims/abstract",
      "priority_date": "YYYY-MM-DD",
      "filing_date": "YYYY-MM-DD",
      "grant_date": "YYYY-MM-DD",
      "publication_date": "YYYY-MM-DD",
      "inventor": "Inventor name(s)",
      "assignee": "Assignee/Company name",
      "publication_number": "{COUNTRY}{NUMBER}{TYPE}",
      "language": "en",
      "thumbnail": "https://patentimages.storage.googleapis.com/...",
      "pdf": "https://patentimages.storage.googleapis.com/...",
      "figures": [
        {
          "thumbnail": "https://patentimages.storage.googleapis.com/...",
          "full": "https://patentimages.storage.googleapis.com/..."
        }
      ],
      "country_status": {
        "US": "ACTIVE|EXPIRED|PENDING",
        "EP": "ACTIVE|EXPIRED|PENDING",
        // ... other countries
      }
    }
  ],
  "summary": {
    "assignee": [...],
    "inventor": [...],
    "cpc": [...]
  },
  "pagination": {
    "current": 0,
    "next": "https://patents.google.com/xhr/query?url=q%3D%2528Coffee%2529%26page%3D1"
  },
  "serpapi_pagination": {
    "current": 0,
    "next": "https://serpapi.com/search.json?engine=google_patents&page=1&q=%28Coffee%29"
  }
}
```

### 2. Google Patents Details API
**Purpose**: Get detailed information about a specific patent
**Base URL**: `https://serpapi.com/search.json?engine=google_patents_details`

#### Key Parameters:
- `patent_id`: Patent identifier (e.g., "patent/US8495950B2/en")

#### Response Structure:
Similar to organic results but with more detailed information for a single patent.

### 3. Summary Endpoint
**Purpose**: Provides statistical summaries of search results
**Included in**: Main search response under `summary` key

#### Summary Structure:
- **assignee**: Company/assignee statistics with frequency by year ranges
- **inventor**: Inventor statistics with frequency by year ranges
- **cpc**: Cooperative Patent Classification statistics

Each summary category includes:
- `key`: Name (or "Total" for overall stats)
- `percentage`: Percentage of total results
- `frequency`: Array of year ranges with percentages

## Patent Data Fields

### Basic Information
- **patent_id**: Unique patent identifier
- **title**: Patent title
- **snippet**: Abstract/claims summary
- **publication_number**: Patent number (e.g., "US8495950B2")

### Dates
- **priority_date**: Priority filing date
- **filing_date**: Application filing date
- **grant_date**: Patent grant date
- **publication_date**: Publication date

### Parties
- **inventor**: Inventor names
- **assignee**: Assignee/company names

### Media
- **thumbnail**: Patent document thumbnail URL
- **pdf**: Full PDF document URL
- **figures**: Array of drawing figures with thumbnail and full resolution URLs

### Status
- **country_status**: Patent status by country (ACTIVE, EXPIRED, PENDING, etc.)

## Usage Notes

1. **API Key Required**: All requests require a SerpApi key
2. **Rate Limiting**: Subject to SerpApi rate limits
3. **Pagination**: Use `serpapi_pagination.next` for subsequent pages
4. **Image Access**: Figures and documents are hosted on Google's patent images storage
5. **Country Coverage**: Patents from multiple jurisdictions (US, EP, WO, etc.)

## Integration Considerations

- Response format is JSON
- Patent IDs follow format: `patent/{COUNTRY}{NUMBER}{TYPE}/en`
- Dates are in ISO format (YYYY-MM-DD)
- Multiple inventors/assignees are typically comma-separated
- CPC classifications provide technical categorization
- Status tracking available per country

This API structure enables comprehensive patent research, competitor analysis, and intellectual property monitoring.

## Integration with Prior Art Search Module (Phase 1)

### Application Context
The prior art search module will use this SerpAPI structure as the target format for LLM-generated patent search queries. Phase 1 focuses on query generation and validation, while Phase 2 will execute the actual searches.

### Query Bundle Schema for SerpAPI Integration

Based on the SRS requirements, the system will generate structured JSON bundles that map to SerpAPI parameters:

```json
{
  "source_summary": {
    "title": "Invention title",
    "problem_statement": "Problem being solved",
    "solution_summary": "Technical solution"
  },
  "core_concepts": ["concept1", "concept2"],
  "synonym_groups": [["term1", "synonym1"], ["term2", "synonym2"]],
  "phrases": ["exact phrase 1", "exact phrase 2"],
  "exclude_terms": ["term to exclude"],
  "technical_features": ["specific technical elements"],
  "spec_limits": [
    {
      "quantity": "voltage",
      "operator": ">=",
      "value": 100,
      "unit": "volts"
    }
  ],
  "cpc_candidates": ["H01M", "H02J"],
  "ipc_candidates": ["H01M 10/00"],
  "domain_tags": ["battery", "energy storage"],
  "date_window": {
    "from": "2010-01-01",
    "to": "2024-12-31"
  },
  "jurisdictions_preference": ["US", "EP", "WO", "CN", "JP", "KR"],
  "ambiguous_terms": ["transit", "cell"],
  "sensitive_tokens": [],
  "query_variants": [
    {
      "label": "broad",
      "q": "battery AND (lithium OR li-ion) AND (storage OR energy)",
      "num": 20,
      "page": 1,
      "notes": "Broad search for maximum recall"
    },
    {
      "label": "baseline",
      "q": "battery AND lithium AND storage AND voltage>100",
      "num": 20,
      "page": 1,
      "notes": "Balanced search with key terms"
    },
    {
      "label": "narrow",
      "q": "battery AND lithium AND storage AND voltage>=100 AND \"energy density\"",
      "num": 20,
      "page": 1,
      "notes": "Focused search for precision"
    }
  ],
  "serpapi_defaults": {
    "engine": "google_patents",
    "hl": "en",
    "no_cache": false
  },
  "fields_for_details": [
    "title",
    "abstract",
    "claims",
    "classifications",
    "publication_date",
    "priority_date",
    "patent_citations",
    "non_patent_citations",
    "pdf"
  ],
  "detail_priority_rules": "Prioritize recent publications with high citation counts"
}
```

### Mapping to SerpAPI Parameters

**Query Construction:**
- `query_variants[].q` → SerpAPI `q` parameter
- `query_variants[].num` → SerpAPI `num` parameter (results per page)
- `query_variants[].page` → SerpAPI `start` parameter (pagination)
- `serpapi_defaults` → Additional SerpAPI parameters

**Search Strategy Implementation:**
- **Broad variant**: Maximum recall using OR operators and synonym groups
- **Baseline variant**: Balanced approach with core concepts and spec limits
- **Narrow variant**: Precision-focused with quoted phrases and constraints

**Advanced Filtering (Phase 2):**
- `cpc_candidates`/`ipc_candidates` → Classification-based filtering
- `date_window` → Date range filtering
- `jurisdictions_preference` → Country/jurisdiction filtering
- `exclude_terms` → Negative keyword filtering

### Guardrails and Validation

**Query Construction Rules:**
- Maximum 300 characters per query
- Maximum 2 quoted phrases per variant
- At least 2 OR-groups for synonym expansion
- No sensitive tokens (emails, internal names, etc.)
- Google Boolean syntax only: parentheses, AND/OR, quotes, minus (-)

**Schema Validation:**
- Exactly 3 query variants (broad/baseline/narrow)
- Required fields: source_summary, core_concepts, etc.
- Array validations: synonym_groups as arrays of arrays
- Numeric constraints: num (1-50), page (1-20)

### LLM Integration Strategy

**Prompt Design:**
- Domain-agnostic patent search strategist persona
- Structured JSON output requirement
- Boolean query construction guidelines
- Guardrail awareness (no hallucinations, ambiguity detection)

**Quality Metrics:**
- Target: ≥80% of LLM-generated bundles pass validation without manual edits
- Ambiguity detection and context term inclusion
- Sensitive token identification and removal

### Phase 2 Execution Plan

Once bundles are approved in Phase 1:

1. **Search Execution**: Call SerpAPI for each query variant
2. **Result Processing**: Parse organic_results into structured patent data
3. **Detail Fetching**: Use patent_ids to get full details via Details API
4. **Ranking & Scoring**: Apply detail_priority_rules for relevance ranking
5. **Deduplication**: Merge results across variants
6. **Presentation**: Display results with patent metadata, figures, and status

### Metering Integration Points

- **Token Counting**: Track LLM usage for query generation
- **Search Credits**: Reserve SerpAPI call credits for Phase 2 execution
- **Tier Enforcement**: Enable/disable LLM assistance based on user tier
- **Cost Estimation**: Show potential SerpAPI costs before Phase 2 execution

This design creates a robust pipeline from invention briefs to validated patent search queries, with clear separation between query generation (Phase 1) and search execution (Phase 2).

-- Office Action case documents: mark the kinds nothing retrieves as NOT_REQUIRED.
--
-- Only SPECIFICATION and SUPPLEMENTARY chunks are ever vector-searched
-- (response-drafter and strategy-service retrieve with kinds ['SPECIFICATION'];
-- supplementary evidence is retrieved per objection). CLAIMS reach the claim
-- charts whole via OfficeActionCase.claimsText and DRAWINGS are not retrieved at
-- all, so neither is embedded any more.
--
-- Rows added before that rule existed sit at PENDING and would render as
-- "not searchable" forever, which reads as a stuck job rather than a document
-- that never needed indexing. Data-only; no schema change.
UPDATE "oa_case_documents"
   SET "indexStatus" = 'NOT_REQUIRED'
 WHERE "kind" IN ('CLAIMS', 'DRAWINGS')
   AND "indexStatus" IN ('PENDING', 'FAILED');

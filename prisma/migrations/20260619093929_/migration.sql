-- DropIndex
DROP INDEX "local_patents_abstract_trgm_idx";

-- DropIndex
DROP INDEX "local_patents_applicationNumberRaw_trgm_idx";

-- DropIndex
DROP INDEX "local_patents_classifications_gin_idx";

-- DropIndex
DROP INDEX "local_patents_corpusSources_gin_idx";

-- DropIndex
DROP INDEX "local_patents_filingDate_idx";

-- DropIndex
DROP INDEX "local_patents_pqaiFetchedAt_idx";

-- DropIndex
DROP INDEX "local_patents_publicationDate_idx";

-- DropIndex
DROP INDEX "local_patents_publicationNumber_trgm_idx";

-- DropIndex
DROP INDEX "local_patents_title_trgm_idx";

-- AlterTable
ALTER TABLE "ipindia_journal_archive_control" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ipindia_journal_files" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "local_patent_embeddings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "local_patents" ALTER COLUMN "corpusSources" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "patent_import_batches" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "patent_import_files" ALTER COLUMN "updatedAt" DROP DEFAULT;

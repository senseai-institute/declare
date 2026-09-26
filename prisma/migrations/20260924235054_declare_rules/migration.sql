-- AlterTable
ALTER TABLE "games" ADD COLUMN     "rules" TEXT;

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "declare_success" BOOLEAN,
ADD COLUMN     "declarer_id" TEXT;

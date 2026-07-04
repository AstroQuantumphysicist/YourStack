-- AlterEnum
ALTER TYPE "AppStatus" ADD VALUE 'unreachable';

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "lastReconcileAt" TIMESTAMP(3);

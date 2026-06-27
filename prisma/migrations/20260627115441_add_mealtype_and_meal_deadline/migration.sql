-- CreateEnum
CREATE TYPE "MealCategory" AS ENUM ('MEAT', 'VEGETARIAN');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "mealRegistrationDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "mealType" "MealCategory" NOT NULL DEFAULT 'MEAT';

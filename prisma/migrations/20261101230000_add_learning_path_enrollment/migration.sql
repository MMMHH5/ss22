CREATE TABLE "LearningPathEnrollment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pathId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "LearningPathEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningPathEnrollment_pathId_studentId_key"
ON "LearningPathEnrollment"("pathId", "studentId");

CREATE INDEX "LearningPathEnrollment_studentId_createdAt_idx"
ON "LearningPathEnrollment"("studentId", "createdAt");

ALTER TABLE "LearningPathEnrollment"
ADD CONSTRAINT "LearningPathEnrollment_pathId_fkey"
FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningPathEnrollment"
ADD CONSTRAINT "LearningPathEnrollment_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

CREATE TABLE "SessionAttendance" (
    "id" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "markedById" TEXT,

    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionAttendance_sessionId_enrollmentId_key"
ON "SessionAttendance"("sessionId", "enrollmentId");

CREATE INDEX "SessionAttendance_enrollmentId_markedAt_idx"
ON "SessionAttendance"("enrollmentId", "markedAt");

ALTER TABLE "SessionAttendance"
ADD CONSTRAINT "SessionAttendance_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionAttendance"
ADD CONSTRAINT "SessionAttendance_enrollmentId_fkey"
FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionAttendance"
ADD CONSTRAINT "SessionAttendance_markedById_fkey"
FOREIGN KEY ("markedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

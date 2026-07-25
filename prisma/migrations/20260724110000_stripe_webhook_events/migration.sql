-- Slice 9: Stripe webhook idempotency. One row per processed Stripe event.id;
-- the unique constraint is what makes a replayed delivery a no-op.
CREATE TABLE "stripe_webhook_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stripe_webhook_events_event_id_key" ON "stripe_webhook_events"("event_id");

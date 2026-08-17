-- Agent decision chain integrity.
--
-- `AgentDecision_no_self_supersede` only stops a row pointing at itself. It says nothing
-- about a decision superseding one that belongs to a different exporter, a different target,
-- a different subject, or one that is no longer the tip of its chain — each of which would
-- corrupt "what is in force for this subject" while looking perfectly valid at the row level.
--
-- None of that is expressible as a CHECK, because every one of these facts lives in ANOTHER
-- row. A composite foreign key cannot carry it either: the subject columns are nullable, and
-- under MATCH SIMPLE a composite FK is skipped entirely as soon as one referencing column is
-- NULL — which is always true here, since exactly one subject column is populated by design.
-- So the guarantee is a BEFORE INSERT trigger, which is the only mechanism that can read the
-- prior row and the chain tip at write time.

CREATE OR REPLACE FUNCTION "agent_decision_validate_chain"() RETURNS trigger AS $$
DECLARE
    prior      "AgentDecision"%ROWTYPE;
    chain_tip  TEXT;
BEGIN
    -- The tip of this subject's chain: the one decision that nothing else supersedes.
    --
    -- Defined structurally rather than as "the newest created_at", so it cannot be confused
    -- by two rows sharing a timestamp. Combined with the UNIQUE index on supersedes_id, a
    -- subject has at most one tip at all times.
    SELECT d."id" INTO chain_tip
    FROM "AgentDecision" d
    WHERE d."market_assessment_id"    IS NOT DISTINCT FROM NEW."market_assessment_id"
      AND d."buyer_fit_assessment_id" IS NOT DISTINCT FROM NEW."buyer_fit_assessment_id"
      AND NOT EXISTS (SELECT 1 FROM "AgentDecision" s WHERE s."supersedes_id" = d."id");

    IF NEW."supersedes_id" IS NULL THEN
        -- A root decision is only valid when the subject has no decisions at all. Otherwise
        -- this would be a second root: two independent chains over one subject, with no
        -- defensible answer to which one is in force.
        IF chain_tip IS NOT NULL THEN
            RAISE EXCEPTION 'AgentDecision: subject already has decision % — supersede it rather than starting a competing chain', chain_tip
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;

    SELECT * INTO prior FROM "AgentDecision" WHERE "id" = NEW."supersedes_id";
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AgentDecision: superseded decision % does not exist', NEW."supersedes_id"
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF prior."exporter_org_id" <> NEW."exporter_org_id" THEN
        RAISE EXCEPTION 'AgentDecision: cannot supersede a decision belonging to another exporter'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF prior."target" <> NEW."target" THEN
        RAISE EXCEPTION 'AgentDecision: cannot supersede a decision with a different target'
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Exact subject identity. IS DISTINCT FROM so a NULL on either side compares correctly
    -- rather than collapsing to NULL and passing the test by accident.
    IF prior."market_assessment_id"    IS DISTINCT FROM NEW."market_assessment_id"
    OR prior."buyer_fit_assessment_id" IS DISTINCT FROM NEW."buyer_fit_assessment_id" THEN
        RAISE EXCEPTION 'AgentDecision: cannot supersede a decision about a different subject'
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Only the tip may be superseded. Superseding a historical row would fork the chain into
    -- two competing tips; the UNIQUE index catches the exact-duplicate case, this catches
    -- every other arbitrary historical target.
    IF chain_tip IS DISTINCT FROM NEW."supersedes_id" THEN
        RAISE EXCEPTION 'AgentDecision: decision % is not the latest for this subject (latest is %)', NEW."supersedes_id", chain_tip
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_decision_chain_integrity"
    BEFORE INSERT ON "AgentDecision"
    FOR EACH ROW EXECUTE FUNCTION "agent_decision_validate_chain"();

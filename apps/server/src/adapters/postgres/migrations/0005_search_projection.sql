ALTER TYPE "public"."idempotency_operation" ADD VALUE IF NOT EXISTS 'category_create';
--> statement-breakpoint
ALTER TYPE "public"."idempotency_operation" ADD VALUE IF NOT EXISTS 'money_space_create';
--> statement-breakpoint
ALTER TABLE "money_memos"
  ADD COLUMN "search_document" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "money_memos"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("search_document", ''))) STORED;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cashmemo_refresh_memo_search_document"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  category_name text;
  money_space_name text;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT name INTO category_name
      FROM categories
     WHERE id = NEW.category_id AND user_id = NEW.user_id;
  END IF;
  IF NEW.money_space_id IS NOT NULL THEN
    SELECT name INTO money_space_name
      FROM money_spaces
     WHERE id = NEW.money_space_id AND user_id = NEW.user_id;
  END IF;
  NEW.search_document := concat_ws(' ', NEW.note, category_name, money_space_name);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "money_memos_refresh_search_document"
BEFORE INSERT OR UPDATE OF note, category_id, money_space_id
ON "money_memos"
FOR EACH ROW
EXECUTE FUNCTION "cashmemo_refresh_memo_search_document"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cashmemo_refresh_category_search_documents"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE money_memos AS memo
     SET search_document = concat_ws(
       ' ',
       memo.note,
       NEW.name,
       (SELECT space.name FROM money_spaces AS space
         WHERE space.id = memo.money_space_id AND space.user_id = memo.user_id)
     )
   WHERE memo.user_id = NEW.user_id AND memo.category_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "categories_refresh_memo_search_documents"
AFTER UPDATE OF name, status
ON "categories"
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION "cashmemo_refresh_category_search_documents"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cashmemo_refresh_money_space_search_documents"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE money_memos AS memo
     SET search_document = concat_ws(
       ' ',
       memo.note,
       (SELECT category.name FROM categories AS category
         WHERE category.id = memo.category_id AND category.user_id = memo.user_id),
       NEW.name
     )
   WHERE memo.user_id = NEW.user_id AND memo.money_space_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "money_spaces_refresh_memo_search_documents"
AFTER UPDATE OF name, status
ON "money_spaces"
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION "cashmemo_refresh_money_space_search_documents"();
--> statement-breakpoint
UPDATE money_memos AS memo
   SET search_document = concat_ws(
     ' ',
     memo.note,
     (SELECT category.name FROM categories AS category
       WHERE category.id = memo.category_id AND category.user_id = memo.user_id),
     (SELECT space.name FROM money_spaces AS space
       WHERE space.id = memo.money_space_id AND space.user_id = memo.user_id)
   );
--> statement-breakpoint
CREATE INDEX "money_memos_search_vector_idx"
ON "money_memos" USING gin ("search_vector");

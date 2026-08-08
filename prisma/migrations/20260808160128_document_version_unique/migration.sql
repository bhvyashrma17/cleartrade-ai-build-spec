-- A deal must never have two Document rows claiming the same (doc_type, version).
CREATE UNIQUE INDEX "Document_deal_id_doc_type_version_key" ON "Document"("deal_id", "doc_type", "version");

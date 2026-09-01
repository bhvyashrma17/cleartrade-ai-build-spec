-- Licensed commercial trade content is its own epistemic class. A specialist provider may
-- reproduce a customs authority's tariff and regulatory content faithfully, but it remains a
-- secondary distributor, so its rows must never be filed as authoritative_public.
--
-- Adding the value admits nothing on its own: a fact only enters this class when the server-side
-- approval registry in src/lib/market-access/licensed-providers.ts covers the provider, dataset,
-- destination and assertion type, and that registry is empty. No existing row changes class, so
-- no historical assessment changes meaning.
ALTER TYPE "EvidenceAssertionClass" ADD VALUE 'licensed_authoritative_content';

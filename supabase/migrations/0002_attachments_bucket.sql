-- Tickets, vouchers and your photos of places. Private: there are no storage policies for it, so only Estela's server
-- (with the secret key) can read or write files here; the browser always goes through the server, which checks who
-- may see each one. Same 15 MB limit as the app.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

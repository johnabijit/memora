# Memora

Memora is a private personal memory and life timeline app backed by Supabase.

## Included

- Email and password authentication
- Row Level Security per user
- Personal memory capture
- Object location history
- Ask Memora retrieval
- Memories and timeline views
- People, places and things
- Private document uploads
- Connections screen
- JSON export
- PWA basics

## Run locally

Use any local HTTP server, for example:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

## Security

The frontend contains only the Supabase publishable key. Never put a service role key or database password in this repository.

All user data access is protected by Supabase Row Level Security.

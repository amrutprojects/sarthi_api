# Read replica: one database for writes, one for reads

The API can use two PostgreSQL databases:

| Role | What goes there |
|---|---|
| **Primary** (`DB_HOST`, port 5432) | every insert, update and delete, every transaction, raw SQL, migrations and seeds |
| **Read replica** (`DB_READ_HOST`, e.g. port 5433) | plain reads outside a transaction: lists, detail pages, dropdowns |

The replica is a **streaming copy** of the primary, kept up to date by PostgreSQL itself. The API never writes to two
databases: it writes once to the primary, and PostgreSQL copies the change to the replica.

With `DB_READ_HOST` unset (the default), the API uses one database for everything, exactly as before.

## Behaviour

- The primary waits on each commit until the replica has applied the change (`synchronous_commit = remote_apply`), so
  a screen that reads right after saving always sees the new data.
- **If the replica stops, writes on the primary wait for it.** `/api/v1/health` then reports `readReplica: "down"`. To
  keep the API working while you fix it, see "Replica down" below.
- `/api/v1/health` shows `readReplica: "up"` when the replica answers and is really a read-only copy, `"down"` when it
  does not, and `"off"` when no replica is configured.
- On the same server the replica shares CPU, memory and disk with the primary, so the gain is limited. Moving the
  replica to its own server (or AWS RDS) later only changes `DB_READ_HOST`.

## Setup on the staging server (Ubuntu, same machine, port 5433)

Run as root. `VER` is the installed PostgreSQL major version (`ls /etc/postgresql`). Choose a strong password for
the `replicator` user and keep it out of shell history (`read -s`).

### 1. Primary: allow replication

```bash
VER=$(ls /etc/postgresql | sort -n | tail -1); echo "PostgreSQL $VER"
read -s -p "Password for the replicator user: " REPL_PW; echo
sudo -u postgres psql -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$REPL_PW';"
```

Add these lines to `/etc/postgresql/$VER/main/postgresql.conf`:

```
wal_level = replica
max_wal_senders = 5
wal_keep_size = 512MB
synchronous_standby_names = 'replica1'
synchronous_commit = remote_apply
```

Add this line to `/etc/postgresql/$VER/main/pg_hba.conf`:

```
host  replication  replicator  127.0.0.1/32  scram-sha-256
```

Restart the primary:

```bash
systemctl restart postgresql@$VER-main
```

### 2. Create the replica (port 5433) as a copy of the primary

```bash
pg_createcluster $VER replica --port 5433
systemctl stop postgresql@$VER-replica
rm -rf /var/lib/postgresql/$VER/replica/*
sudo -u postgres env PGPASSWORD="$REPL_PW" pg_basebackup -h 127.0.0.1 -p 5432 -U replicator \
  -D /var/lib/postgresql/$VER/replica -R -X stream -P \
  -d "application_name=replica1"
systemctl start postgresql@$VER-replica
unset REPL_PW
```

`-R` writes the replica's connection settings and marks it as a standby; `application_name=replica1` matches
`synchronous_standby_names` on the primary.

### 3. Check that replication works

```bash
sudo -u postgres psql -p 5432 -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
sudo -u postgres psql -p 5433 -c "SELECT pg_is_in_recovery();"
```

The first shows `replica1 | streaming | sync`; the second shows `t` (it is a read-only copy).

### 4. Point the API at it

Add to the API's `.env`:

```
DB_READ_HOST=127.0.0.1
DB_READ_PORT=5433
```

The replica has the same users and passwords as the primary (it is a copy), so `DB_READ_USERNAME` and
`DB_READ_PASSWORD` are not needed. Then restart and check:

```bash
pm2 restart sarthi-api --update-env
curl -s http://127.0.0.1:5001/api/v1/health
```

`"readReplica":"up"` means reads now go to the replica.

## Replica down

Writes wait while the synchronous replica is unavailable. To keep the API working while it is repaired, switch the
primary to asynchronous and send reads back to the primary:

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET synchronous_standby_names = '';" -c "SELECT pg_reload_conf();"
```

Then remove `DB_READ_HOST` from `.env` and run `pm2 restart sarthi-api --update-env`. Undo both once the replica
is back (`ALTER SYSTEM RESET synchronous_standby_names;` and reload).

## Removing the replica

Remove `DB_READ_HOST` / `DB_READ_PORT` from `.env` and restart the API. Then, on the server:
`ALTER SYSTEM RESET synchronous_standby_names;`, reload, and `pg_dropcluster --stop $VER replica`.

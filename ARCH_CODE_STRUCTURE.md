# Code Structure Notes

## Why monorepo
- shared contracts + consistent middleware
- easier multi-service refactor and version lock

## Next implementation priorities
1. gateway: redis rate-limit + JWT + downstream proxy
2. user/gameplay/ad/payment: replace placeholders with real handlers
3. kafka outbox + idempotency middleware
4. observability middleware (trace/log/metrics)

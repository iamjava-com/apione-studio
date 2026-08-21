-- `updated_at` was never read: mocks have no history panel and nothing orders by it.
ALTER TABLE `mock_configs` DROP COLUMN `updated_at`;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_server') THEN
    GRANT USAGE ON SCHEMA public TO aven_server;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", account, verification, proof_of_work_challenges TO aven_server;
    GRANT SELECT, INSERT, UPDATE, DELETE ON passkey, setup_links TO aven_server;
    GRANT SELECT, INSERT, UPDATE, DELETE ON names, name_holds, purchase_sessions TO aven_server;
    GRANT SELECT, INSERT ON payment_events TO aven_server;
    GRANT SELECT, INSERT, UPDATE ON customer_environments, customer_environment_jobs TO aven_server;
    GRANT SELECT, INSERT ON email_queue, audit_events TO aven_server;
    GRANT SELECT ON worker_heartbeats TO aven_server;
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_email_worker') THEN
    GRANT USAGE ON SCHEMA public TO aven_email_worker;
    GRANT SELECT, UPDATE ON email_queue TO aven_email_worker;
    GRANT SELECT, INSERT, UPDATE ON worker_heartbeats TO aven_email_worker;
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_environment_worker') THEN
    GRANT USAGE ON SCHEMA public TO aven_environment_worker;
    GRANT SELECT, UPDATE ON customer_environments, customer_environment_jobs TO aven_environment_worker;
    GRANT SELECT, INSERT ON customer_environment_logs TO aven_environment_worker;
    GRANT USAGE, SELECT ON SEQUENCE customer_environment_logs_id_seq TO aven_environment_worker;
    GRANT INSERT ON audit_events TO aven_environment_worker;
    GRANT SELECT, INSERT, UPDATE ON worker_heartbeats TO aven_environment_worker;
  END IF;
END $$;

-- Open SePay rent events (waiting or being replayed) are read on every payment-status call.
CREATE INDEX sepay_events_open ON sepay_events(house_id, month) WHERE status IN ('deferred', 'replaying');

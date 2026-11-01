//! Turn-taking for ledger snapshots: one is built at a time.

/// Ledger closes waiting on the snapshot builder. A close that lands
/// mid-build waits its turn instead of being dropped, and only the newest
/// one waits, so the feed runs at most one ledger behind and skips one only
/// when a build outlasts two closes.
#[derive(Debug)]
pub struct LedgerQueue<T> {
    busy: bool,
    waiting: Option<T>,
}

impl<T> Default for LedgerQueue<T> {
    fn default() -> Self {
        Self {
            busy: false,
            waiting: None,
        }
    }
}

impl<T> LedgerQueue<T> {
    /// Takes a new close. Returns it when the builder is free to start on it
    /// now; otherwise it waits, replacing any older close still waiting.
    pub fn offer(&mut self, close: T) -> Option<T> {
        if self.busy {
            self.waiting = Some(close);
            return None;
        }
        self.busy = true;
        Some(close)
    }

    /// Ends the current build and returns the close to build next, if any.
    pub fn finish(&mut self) -> Option<T> {
        let next = self.waiting.take();
        self.busy = next.is_some();
        next
    }
}

#[cfg(test)]
mod tests {
    use super::LedgerQueue;

    #[test]
    fn starts_a_close_at_once_when_idle() {
        let mut queue = LedgerQueue::default();
        assert_eq!(queue.offer(1), Some(1));
        assert_eq!(queue.finish(), None);
        assert_eq!(queue.offer(2), Some(2));
    }

    #[test]
    fn a_close_during_a_build_waits_its_turn() {
        let mut queue = LedgerQueue::default();
        assert_eq!(queue.offer(1), Some(1));
        assert_eq!(queue.offer(2), None);
        assert_eq!(queue.finish(), Some(2));
        // Still building 2, so 3 waits too.
        assert_eq!(queue.offer(3), None);
        assert_eq!(queue.finish(), Some(3));
        assert_eq!(queue.finish(), None);
    }

    #[test]
    fn only_the_newest_close_waits() {
        let mut queue = LedgerQueue::default();
        assert_eq!(queue.offer(1), Some(1));
        assert_eq!(queue.offer(2), None);
        assert_eq!(queue.offer(3), None);
        assert_eq!(queue.finish(), Some(3));
        assert_eq!(queue.finish(), None);
    }
}

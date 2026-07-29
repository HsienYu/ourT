import unittest

from processors.label_assigner import LabelAssigner


class LabelAssignerTests(unittest.TestCase):
    def test_assigns_a_cleaned_label_stably_per_track(self):
        assigner = LabelAssigner([" 甲 ", "", 12, "乙"])

        label = assigner.assign(7)

        self.assertIn(label, ["甲", "乙"])
        self.assertEqual(assigner.assign(7), label)

    def test_returns_empty_label_without_a_pool(self):
        self.assertEqual(LabelAssigner([]).assign(7), "")

    def test_uses_a_shared_fallback_for_untracked_people(self):
        assigner = LabelAssigner(["甲", "乙"])

        label = assigner.assign(None)

        self.assertIn(label, ["甲", "乙"])
        self.assertEqual(assigner.assign(None), label)


if __name__ == "__main__":
    unittest.main()

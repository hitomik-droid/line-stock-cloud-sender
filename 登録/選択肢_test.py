import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


class BusinessChoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory()
        root = Path(cls.work.name)
        (root / 'cands.json').write_text(json.dumps([]))
        (root / 'results.jsonl').write_text('')
        previous = os.environ.get('WORK')
        os.environ['WORK'] = str(root)
        try:
            spec = importlib.util.spec_from_file_location('choice_judge', Path(__file__).with_name('判定.py'))
            cls.judge = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.judge)
        finally:
            if previous is None:
                os.environ.pop('WORK', None)
            else:
                os.environ['WORK'] = previous

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def test_business_and_customer_requests_are_distinct(self):
        cases = [
            ('業務提携の申込み', True, False),
            ('お取引のご相談', True, False),
            ('営業提案', True, False),
            ('工事前のご質問', False, True),
            ('工事中のご質問', False, True),
            ('入校申込', False, True),
            ('資料請求（法人）', False, True),
            ('業務提携の申込み（工事前相談）', False, True),
            ('その他', False, False),
        ]
        for value, business, wrong in cases:
            with self.subTest(value=value):
                self.assertEqual(self.judge.business_choice(value), business)
                self.assertEqual(self.judge.wrong_choice(value), wrong)


if __name__ == '__main__':
    unittest.main()

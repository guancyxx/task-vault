"""跨实现一致性语料（PR #3 审计 §2/§4 债）。

同一份 JSON 在 TS/Python 双侧断言以防漂移；期望值钉住三处已知结构差异：
D1 续行卡点仅 TS 命中，D2 todo 展示与补派采用宽/严两种接单基线，
D3 TS 卡点相要求先接单而 review audit 不要求。
"""

import json
import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.dispatch_backstop import accepted_after  # noqa: E402
from scripts.review_audit import entries  # noqa: E402
from scripts.tv_common import SHANGHAI  # noqa: E402


# 镜像 review_audit.main() 的分支结构——assignee 门 + done/review 抢先 +
# 最新条目 headline 含卡点；main() 内联无法直接调用，改谓词须同步。
def audit_stuck(status, assignee, body):
    if assignee in ("", "user"):
        return False
    if status in ("done", "review"):
        return False
    es = entries(body)
    return bool(es) and "卡点" in es[0][1]


with (ROOT / "tests" / "corpus" / "agent-log.json").open(encoding="utf-8") as source:
    CORPUS = json.load(source)


class AgentLogCorpusTest(unittest.TestCase):
    def test_backstop_and_audit_snapshot_matrix(self):
        for case in CORPUS["cases"]:
            with self.subTest(case=case["name"]):
                expected = case["expect"]
                self.assertEqual(accepted_after(case["body"], None), expected["backstopAny"])
                if case["since"] is not None:
                    since = datetime.fromisoformat(case["since"]).replace(tzinfo=SHANGHAI)
                    self.assertEqual(accepted_after(case["body"], since), expected["backstopSince"])
                self.assertEqual(
                    audit_stuck(case["status"], case["assignee"], case["body"]),
                    expected["auditStuck"],
                )


if __name__ == "__main__":
    unittest.main()

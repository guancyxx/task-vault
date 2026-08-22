#!/bin/bash
# Task Vault dispatch hook (FR-021)。插件「委派」时 fire，兜底 cron 补派也走这里。
# 职责一条：在任务所属仓库起一个 agent 会话，把任务文件交给它。
#
# 为什么是 `claude -p` 而不是开终端窗口跑交互式：实测 `claude "<prompt>"` 只把 prompt
# 预填进 TUI、**不提交**（进程 0% CPU 干等、不产生 session 文件），委派等于没发生。
# 权限用 --allowedTools 白名单 + acceptEdits（铁律禁用 --dangerously-skip-permissions）。
# ponytail: 白名单外的 Bash 会被静默拒绝 —— agent 按协议留「[卡点]」，人补白名单再 --force 重派。
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.openagents/nodejs/bin:$PATH"

VAULT="/Users/guanchunyuan/Documents/Obsidian Vault"
SPEC="$VAULT/02 Knowledge/任务系统规范.md"
LOG="$HOME/.hermes/cache/tv-dispatch-hook.log"
RUN_DIR="$HOME/.hermes/cache/tv-dispatch"
PUSH="$HOME/.hermes/scripts/ntfy-push.py"
mkdir -p "$(dirname "$LOG")" "$RUN_DIR"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
die() { log "ABORT: $*"; exit 1; }

TASK_PATH="${TV_TASK_PATH:-}"
[ -n "$TASK_PATH" ] || die "TV_TASK_PATH 为空"
# 插件传 vault 相对路径，兜底 cron 传绝对路径 —— 两种都收
case "$TASK_PATH" in /*) ;; *) TASK_PATH="$VAULT/$TASK_PATH" ;; esac
[ -f "$TASK_PATH" ] || die "任务文件不存在: $TASK_PATH"

TASK_ID="${TV_TASK_ID:-unknown}"
TITLE="${TV_TASK_TITLE:-task}"
ASSIGNEE="${TV_TASK_ASSIGNEE:-}"
[ -n "$ASSIGNEE" ] || die "TV_TASK_ASSIGNEE 为空: $TITLE"

# cwd = 任务所属仓库。hook 环境没有 project 变量，从 frontmatter 现读。
PROJECT=$(sed -n 's/^project: *//p' "$TASK_PATH" | head -1 | tr -d '\r')
case "$PROJECT" in
  magicedit)       WORKDIR="$HOME/dreampal.ai/magicedit" ;;
  internal-server) WORKDIR="$HOME/dreampal.ai/magicedit/internal-server" ;;
  # ponytail: 其余按 ~/workspace/<project> 猜，猜不到回落 vault（纯文档任务本来就在 vault 里做）
  *) if [ -n "$PROJECT" ] && [ -d "$HOME/workspace/$PROJECT" ]; then
       WORKDIR="$HOME/workspace/$PROJECT"
     else
       WORKDIR="$VAULT"
     fi ;;
esac

# 指令全文在任务文件的 `## 委派` 区里，prompt 只负责把 agent 指到文件和协议。
PROMPT_FILE="$RUN_DIR/$TASK_ID.prompt.txt"
RUN_LOG="$RUN_DIR/$TASK_ID.log"
cat > "$PROMPT_FILE" <<EOF
接手 Task Vault 委派任务：$TASK_PATH

先完整读这个任务文件（## 任务描述 = 背景与已有调研，## 委派 = 本次指令，## 执行记录 = 时间线），
再按《任务系统规范》($SPEC) 第 5 节委派协议执行：

1. 先落「接单」记录并把 frontmatter 的 status 改成 doing
2. 执行中即时追加执行记录（决策/卡点当场写，别攒到最后）
3. 完成 → status: done（终态 hook 自动接归档，不用手动归档）
4. 做不完 → 留 [卡点] 记录 + status: waiting，写清缺什么

收尾规则：若任务 tags 含 auto，或 assignee≠user 且非用户当面委派，完成时 status 只能置 review 不可置 done；写 **doing→review** 迁移记录并附交付摘要（做了什么/产出在哪/需要用户确认什么），然后停下等用户复核。

你是无人值守跑的：没有人能在中途批准权限。白名单外的命令会被拒绝——被拒就按第 4 条
留卡点写清需要什么，不要绕过，也不要假装做完了。

禁令：不碰 mirror 块、不改 id、不删执行记录行、不手写 dispatched。
EOF

# 白名单：够做「读代码→改文件→跑测试→开 PR」，不含删除/部署/生产写入。
ALLOWED="Read,Edit,Write,Glob,Grep,TodoWrite,Bash(git *),Bash(npm *),Bash(npx *),Bash(node *),Bash(python3 *),Bash(bb *),Bash(~/bin/bb *),Bash(rg *),Bash(sed -n *),Bash(grep *),Bash(ls *),Bash(cat *),Bash(docker compose exec *)"

case "$ASSIGNEE" in
  cc)
    (
      cd "$WORKDIR" || exit 1
      claude -p "$(cat "$PROMPT_FILE")" --permission-mode acceptEdits --allowedTools "$ALLOWED" \
        > "$RUN_LOG" 2>&1
      ec=$?
      echo "[$(date '+%F %T')] agent exit=$ec id=$TASK_ID log=$RUN_LOG" >> "$LOG"
      if [ -x "$PUSH" ]; then
        if [ $ec -eq 0 ]; then
          "$PUSH" "Done: $TITLE" "$(tail -c 1500 "$RUN_LOG")" 3 "white_check_mark" >/dev/null 2>&1
        else
          "$PUSH" "Error: $TITLE" "exit=$ec $(tail -c 1000 "$RUN_LOG")" 4 "x" >/dev/null 2>&1
        fi
      fi
    ) >/dev/null 2>&1 &
    ;;
  codex)
    ( cd "$WORKDIR" && codex exec "$(cat "$PROMPT_FILE")" > "$RUN_LOG" 2>&1;
      echo "[$(date '+%F %T')] agent exit=$? id=$TASK_ID log=$RUN_LOG" >> "$LOG" ) >/dev/null 2>&1 &
    ;;
  hermes)
    ( hermes -z "$(cat "$PROMPT_FILE")" > "$RUN_LOG" 2>&1;
      echo "[$(date '+%F %T')] agent exit=$? id=$TASK_ID log=$RUN_LOG" >> "$LOG" ) >/dev/null 2>&1 &
    ;;
  *) die "未知 assignee=$ASSIGNEE (id=$TASK_ID)" ;;
esac

log "dispatched $ASSIGNEE id=$TASK_ID cwd=$WORKDIR log=$RUN_LOG title=$TITLE"
exit 0


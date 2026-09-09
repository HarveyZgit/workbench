use zed_extension_api::{
    self as zed, process::Command, Extension, SlashCommand, SlashCommandOutput,
    SlashCommandOutputSection, Worktree,
};

struct MarkdownCommentExtension;

impl Extension for MarkdownCommentExtension {
    fn new() -> Self {
        Self
    }

    fn run_slash_command(
        &self,
        command: SlashCommand,
        args: Vec<String>,
        worktree: Option<&Worktree>,
    ) -> Result<SlashCommandOutput, String> {
        match command.name.as_str() {
            "mdc-preview" => preview(args, worktree),
            other => Err(format!("unknown slash command: {other}")),
        }
    }
}

fn utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn preview(args: Vec<String>, worktree: Option<&Worktree>) -> Result<SlashCommandOutput, String> {
    let worktree = worktree.ok_or_else(|| {
        "需要打开一个工作区，才能解析路径并查找 markdown-comment CLI".to_string()
    })?;

    let env = worktree.shell_env();
    let file_arg = args
        .first()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            env.iter()
                .find(|(k, _)| k == "ZED_FILE")
                .map(|(_, v)| v.clone())
                .filter(|v| !v.is_empty())
        })
        .ok_or_else(|| {
            "用法: /mdc-preview path/to/file.md（相对项目根或绝对路径）。也可绑定 Task「Markdown Comment: 打开评论预览」用当前文件。".to_string()
        })?;

    let abs = resolve_path(&file_arg, worktree);
    let (program, mut argv) = resolve_cli(worktree)?;
    argv.push("preview".into());
    argv.push(abs.clone());
    argv.push("--detach".into());
    if let Some((_, interval)) = env
        .iter()
        .find(|(k, _)| k == "MARKDOWN_COMMENT_SYNC_INTERVAL")
    {
        argv.push("--sync-interval".into());
        argv.push(interval.clone());
    }

    let output = Command::new(&program)
        .args(&argv)
        .envs(env.iter().cloned())
        .output()
        .map_err(|err| {
            format!(
                "无法启动 preview（{program} {}）: {err}\n\
                 请把 markdown-comment 放到 PATH，或设置 MARKDOWN_COMMENT_CLI 指向 dist/cli.js。",
                argv.join(" ")
            )
        })?;

    if output.status != Some(0) {
        let detail = {
            let err = utf8(&output.stderr);
            if err.trim().is_empty() {
                utf8(&output.stdout)
            } else {
                err
            }
        };
        return Err(format!("preview 失败:\n{}", detail.trim()));
    }

    let text = {
        let out = utf8(&output.stdout);
        if out.trim().is_empty() {
            format!("已打开 Markdown Comment 预览：{abs}")
        } else {
            out
        }
    };

    Ok(SlashCommandOutput {
        sections: vec![SlashCommandOutputSection {
            range: (0..text.len()).into(),
            label: "Markdown Comment preview".to_string(),
        }],
        text,
    })
}

fn resolve_path(file_arg: &str, worktree: &Worktree) -> String {
    if file_arg.starts_with('/') || looks_like_windows_abs(file_arg) {
        file_arg.to_string()
    } else {
        let root = worktree.root_path();
        format!(
            "{}/{}",
            root.trim_end_matches('/').trim_end_matches('\\'),
            file_arg.trim_start_matches("./")
        )
    }
}

fn looks_like_windows_abs(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

fn resolve_cli(worktree: &Worktree) -> Result<(String, Vec<String>), String> {
    if let Some(bin) = worktree.which("markdown-comment") {
        return Ok((bin, Vec::new()));
    }

    let env = worktree.shell_env();
    let node = worktree
        .which("node")
        .ok_or_else(|| "找不到 node（需要 Node.js 跑 CLI）".to_string())?;

    if let Some((_, cli)) = env.iter().find(|(k, _)| k == "MARKDOWN_COMMENT_CLI") {
        if cli.ends_with(".js") {
            return Ok((node, vec![cli.clone()]));
        }
        return Ok((cli.clone(), Vec::new()));
    }

    let root = worktree.root_path();
    let candidates = [
        format!("{root}/packages/markdown-comment/dist/cli.js"),
        format!("{root}/dist/cli.js"),
    ];
    for c in candidates {
        let check = Command::new("sh")
            .arg("-c")
            .arg(format!("test -f {c:?}"))
            .output();
        if let Ok(out) = check {
            if out.status == Some(0) {
                return Ok((node, vec![c]));
            }
        }
    }

    let probe = Command::new("sh")
        .arg("-c")
        .arg(
            r#"
home="${HOME:-}"
for root in "$home/.vscode/extensions" "$home/.cursor/extensions" "$home/.vscode-insiders/extensions"; do
  [ -d "$root" ] || continue
  cli="$(ls -1d "$root"/harveyz.vscode-markdown-comment-*/dist/cli.js 2>/dev/null | sort | tail -1 || true)"
  if [ -n "$cli" ] && [ -f "$cli" ]; then
    printf '%s' "$cli"
    exit 0
  fi
done
exit 1
"#,
        )
        .envs(env.iter().cloned())
        .output();

    if let Ok(out) = probe {
        if out.status == Some(0) {
            let cli = utf8(&out.stdout);
            let cli = cli.trim();
            if !cli.is_empty() {
                return Ok((node, vec![cli.to_string()]));
            }
        }
    }

    Err(
        "找不到 markdown-comment CLI。请把 CLI 放到 PATH，或在本仓库执行 rush build --to vscode-markdown-comment，\
         或设置 MARKDOWN_COMMENT_CLI。"
            .into(),
    )
}

zed::register_extension!(MarkdownCommentExtension);

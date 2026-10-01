import type { TFile } from 'obsidian';
import type { StoredAnchor } from '../../types';

/** 侧栏里正在写的新评论：锚点在提交时才用最新源码构建。 */
export interface Draft {
  file: TFile;
  /** 草稿卡片顶部展示的引用文字。 */
  preview: string;
  /** 用源码文本构建锚点；null 表示无法定位。 */
  build: (text: string) => StoredAnchor | null;
  /** 编辑视图等已确定源码文本时给出；缺省则提交时读磁盘最新内容。 */
  sourceText?: string;
  /** 标签（写进正文前缀），null = 无标签。 */
  label: string | null;
  body: string;
}

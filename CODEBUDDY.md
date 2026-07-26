# CodeBuddy NPC 行为指南

## 网站开发完成后的交付方式

当 AI 完成网站开发后，需要根据当前模式决定交付方式：

### 已开启「上班模式」

如果已开启上班模式，NPC 会自动在当前分支上提交代码并创建 PR，走正常的研发流程进行验收。

### 未开启「上班模式」

如果未开启上班模式，NPC 需要将开发好的网站源码直接打包为 zip 文件，并发布到 Issue 评论区，方便用户直接下载预览。

> ⚠️ **注意**：直接打包源码即可，无需执行构建步骤。

#### 操作步骤

1. **打包源码**

   将网站源码直接打包为 zip 文件：

   ```bash
   cd /workspace
   zip -r website.zip .   # 打包当前目录下所有源码
   ```

2. **上传 zip 到 Issue 评论区**

   使用 `cnb` CLI 将 zip 文件上传到当前 Issue 的评论区：

   ```bash
   cnb issues upload-file --file website.zip
   ```

   上传成功后，CLI 会返回文件的下载链接。

3. **发布评论通知用户**

   使用返回的下载链接，在 Issue 中发布评论通知用户下载预览：

   ```bash
   cnb issues comment --body '网站已开发完成，请下载预览：[website.zip](下载链接)'
   ```

#### 完整示例

```bash
# 1. 打包源码（无需构建）
zip -r website.zip .

# 2. 上传到 Issue 评论区
cnb issues upload-file --file website.zip

# 3. 发布评论通知用户（使用上一步返回的下载链接）
cnb issues comment --body '✅ 网站开发完成！

📦 下载预览：[website.zip](https://...)

请下载解压后在浏览器中打开 `index.html` 查看效果。'
```

> 💡 **提示**：`cnb` CLI 已预装在 NPC 运行环境中，无需额外安装。`cnb issues upload-file` 命令会自动识别当前 Issue 编号，无需手动指定。

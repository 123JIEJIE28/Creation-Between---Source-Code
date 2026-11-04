# 创作工作库：个人登录与线上保存

这份配置用于把网站作为一个 Node 服务运行在 Render。GitHub 保存源码；个人资料和上传图片保存在 Render 的持久磁盘。配置文件本身不会创建服务或产生费用，仍需在 Render 中确认并创建。

## 先在本机使用

使用 Node **24.22.1**（与 `.node-version` 一致），在项目目录打开终端。当前服务没有第三方运行依赖。

```sh
npm start
```

未设置登录环境变量时，本机预览仅监听 `127.0.0.1`，地址为 `http://127.0.0.1:4173`，可免登录使用。此命令不会自动读取 `.env`。

要在本机体验个人登录：

1. 先停止占用 4173 端口的预览进程。
2. 复制 `.env.example` 为 `.env`。
3. 运行 `npm run password:hash`，按提示在终端输入一个独立的网站密码。
4. 把生成的完整哈希填入 `.env` 的 `OWNER_PASSWORD_HASH`，保留或修改 `OWNER_USERNAME`。
5. 运行 `npm run start:configured`，然后使用对应用户名和原始密码登录。

`.env` 仅保存在本机；密码、密码哈希和个人数据不要提交到 GitHub，也不需要发到聊天中。生产环境需要完整登录配置，不会因漏填密码而自动开放资料。

## 创建线上服务

1. 确认 GitHub 仓库根目录已经包含 `render.yaml`、`server.mjs`、`package.json`、`public/`、`lib/` 和 `scripts/hash-password.mjs`。
2. 登录 [Render](https://dashboard.render.com/)，连接 GitHub 账号，允许访问 [Creation-Between---Source-Code](https://github.com/123JIEJIE28/Creation-Between---Source-Code)。
3. 选择新建 **Blueprint**，连接该仓库的 `main` 分支，配置文件使用根目录的 `render.yaml`。
4. 检查服务名、区域和费用。此配置使用 **Starter 服务 + 1 GB 持久磁盘**，两项都是付费资源；请在创建前确认控制台显示的当期价格。需要不同区域时，先在 YAML 中设置 `region`，再创建服务。
5. 创建流程提示 `OWNER_PASSWORD_HASH` 时，粘贴本机 `npm run password:hash` 生成的完整哈希。登录用户名默认是 `123JIEJIE28`；网站密码由你单独设置，与 GitHub 密码无关。
6. 确认创建后，等待服务变为 **Live**，打开 Render 分配的 `https://…onrender.com` 地址。
7. 登录后创建一条资料并上传一张图片，确认刷新后仍存在、原图可以下载。随后手动重启一次服务，再登录核对资料与图片仍在。

`sync: false` 让 Render 在首次创建时单独收集密码哈希。已有服务若新增或修改此秘密值，需要到该服务的 **Environment** 手动设置，不能靠提交 YAML 更新。`autoDeployTrigger: commit` 会在连接分支有新提交时自动部署。详见 [Blueprint 配置说明](https://render.com/docs/blueprint-spec)。

## 环境变量与保存位置

| 变量 | 线上值或来源 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Render 自动提供，不用手动填 4173 |
| `OWNER_USERNAME` | `123JIEJIE28`，可自行修改 |
| `OWNER_PASSWORD_HASH` | 在 Render 中私密填写生成的哈希 |
| `LIBRARY_DATA_DIR` | `/var/data/creative-library` |
| `PUBLIC_ORIGIN` | 默认不填，服务使用 `RENDER_EXTERNAL_URL` |
| `SKIP_INSTALL_DEPS` | `true`，当前服务不需要安装第三方依赖 |

Render 的自动网址和端口由平台提供，见 [默认环境变量](https://render.com/docs/environment-variables)。使用自己的域名时，先在 Render 添加域名并完成 DNS、HTTPS 配置，再把 `PUBLIC_ORIGIN` 设置为准确的 HTTPS 来源，例如 `https://library.example.com`，不加路径。此后使用这个域名登录。

线上资料目录为：

```text
/var/data/creative-library/
├── library.json     资料、提示词、分类、图片引用
└── uploads/         上传的原始图片文件
```

只有磁盘挂载目录 `/var/data` 内的文件会跨重启和重新部署保留。源码目录、`/tmp` 等位置不用于保存资料。持久盘只供一个实例访问，因此保持 `numInstances: 1`，不启用横向扩容。带磁盘的部署会有短暂服务中断；磁盘可扩容，不能缩小。相关限制见 [Render 持久磁盘说明](https://render.com/docs/disks)。

## 把已有本机资料迁移到线上

新服务不会自动读取电脑里的资料。网页里的 JSON 导出只包含记录及图片引用，**不包含图片文件**；完整迁移必须同时带上 `library.json` 和整个 `uploads/`。

1. 停止本机预览服务，在项目目录把整个 `data` 打包到仓库外。以下文件名里的 `YYYYMMDD` 换成当天日期；若本机使用了自定义 `LIBRARY_DATA_DIR`，把 `-C data` 改为实际资料目录。

   ```sh
   umask 077
   mkdir -p ../private-library-backups
   tar --exclude=.library.lock -czf ../private-library-backups/library-YYYYMMDD.tar.gz -C data .
   tar -tzf ../private-library-backups/library-YYYYMMDD.tar.gz
   ```

2. 核对压缩包包含 `./library.json` 和 `./uploads/`。不要把它上传到 GitHub。
3. 按 Render 的 [SSH 设置说明](https://render.com/docs/ssh) 配置本机 SSH 公钥，并从服务的 **Connect → SSH** 复制实际连接地址。使用 SCP 或 SFTP 把压缩包上传至 `/var/data/library-YYYYMMDD.tar.gz`；连接地址和端口以控制台为准，见 [持久盘文件传输](https://render.com/docs/disks#transferring-files)。
4. 暂停使用线上编辑功能，在 Render 的 **Shell** 中解压到一个新的、未使用的目录。不要覆盖正在运行的资料目录：

   ```sh
   mkdir /var/data/creative-library-import-YYYYMMDD
   tar -xzf /var/data/library-YYYYMMDD.tar.gz -C /var/data/creative-library-import-YYYYMMDD
   ```

5. 把 `render.yaml` 中的 `LIBRARY_DATA_DIR` 改为 `/var/data/creative-library-import-YYYYMMDD`，提交到部署分支，等待自动部署完成。修改 YAML 可以避免后续 Blueprint 同步把路径改回旧值。
6. 重新登录，检查资料数量、图片预览和原图下载。原有线上目录暂时保留，用于回退；确认迁移成功并已保存独立备份后，再清理不再需要的压缩包和旧目录。

该过程是切换整套资料，不会自动合并本机与线上新增的内容。打包到验证完成期间，请先停止两边的资料编辑。

## 备份与恢复

建议在集中录入之后、迁移或批量修改之前保存完整备份，并把副本下载到自己的电脑或独立的私有存储。不要只在同一块持久盘上保留备份。

备份时先暂停编辑和上传，等待当前保存完成。在 Render Shell 中运行以下命令，`LIBRARY_DATA_DIR` 会指向当前使用的数据目录：

```sh
umask 077
tar --exclude=.library.lock -czf /var/data/library-backup-YYYYMMDD.tar.gz -C "$LIBRARY_DATA_DIR" .
tar -tzf /var/data/library-backup-YYYYMMDD.tar.gz
```

通过 SCP/SFTP 下载压缩包，确认其中有 JSON 和图片。备份打包时需要额外磁盘空间；1 GB 接近用满时，先扩容或通过 SSH 直接把归档传输到本机。下载确认无误后，清理磁盘上的临时压缩包，保留仓库外的私有副本。

恢复时，先备份当前线上资料，然后按上面迁移步骤将备份解压到 `/var/data/creative-library-restore-YYYYMMDD`，更新 YAML 中的 `LIBRARY_DATA_DIR` 并重新部署。验证通过前保留旧目录。需要回退时，把配置路径改回旧目录再部署。不要直接覆盖正在运行的 `library.json`，服务可能仍持有旧资料并再次写回。

Render 自动磁盘快照是平台恢复手段，不能代替独立备份。当前官方说明为每天一次、保留七天；恢复会替换整块磁盘，丢失快照之后的修改，且不能只恢复部分文件。恢复后重启应用并核对当前目录和资料。详见 [磁盘快照](https://render.com/docs/disks#disk-snapshots)。

## 后续改页面、交互和密码

页面和交互在本机修改、预览和验证，再把源码提交到 GitHub 的部署分支。Render 会自动部署新版本；正常发布不更换或清空资料目录。部署完成后重新登录即可继续使用。

修改登录密码：本机重新运行 `npm run password:hash`，在 Render **Environment** 更新 `OWNER_PASSWORD_HASH`，保存并重新部署或重启。旧会话随进程重启失效。这个版本提供单人登录，没有公开注册或邮件找回；忘记密码时也用这个方法重设。

网站界面和登录入口可公开访问，资料 API、上传图片和原图下载受登录保护。退出登录后，可以用无痕窗口确认资料和图片不能继续读取。GitHub 仓库只保存源码，不承载登录资料，也不等同于网站数据备份。

# 市场索引准备

本目录是 FR-1 的本地分发材料，不是已上线的市场。

- `index.draft.json`：按官方 format 1 编写的草案，自动测试使用固定版本的官方 `parseMarketIndex` 校验。
- `icons/companion.svg`：原生 SVG 图标，包内 `package.json.icon` 与市场草案共用同一资源。
- 用户已提供公开仓库 `mycherish/dsh-deepseek-companion`，并确认 npm 登录用户名为 `caelum-maple`，对应仓库、主页与作者字段已填写；npm 发布认证在实际发布前核对。`publishTimestamp: 0` 仅是本地草案哨兵，不能用作真实发布日期。

发布时应从实际 npm 版本取得版本、发布时间和兼容声明，核对维护者与仓库信息，生成 **`index.json`**，再部署该文件与 `icons/`。不得直接部署 `index.draft.json`，也不能把预览候选写成已发布。

索引托管、免费账号创建、安装步骤和验收结果见 [市场与安装记录](../docs/market-installation.md)。发布顺序以 [首版执行计划](../docs/first-release.md) 为准。

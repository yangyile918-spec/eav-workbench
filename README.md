# 极目售后分析组工作台 - GitHub Pages 部署指南

## 快速部署（5分钟）

### 第1步：登录 GitHub
打开 https://github.com 并登录你的账号

### 第2步：创建新仓库
1. 点击右上角 `+` → `New repository`
2. Repository name 填写：`eav-workbench`
3. 勾选 `Public`（公开仓库）
4. 点击 `Create repository`

### 第3步：上传文件
1. 点击 `uploading an existing file`
2. 把以下5个文件拖进去：
   - `index.html`
   - `app.js`
   - `style.css`
   - `chart.umd.min.js`
   - `xlsx.full.min.js`
3. 点击 `Commit changes`

### 第4步：开启 Pages
1. 点击仓库顶部的 `Settings`
2. 左侧菜单找到 `Pages`
3. Source 选择 `Deploy from a branch`
4. Branch 选择 `main`，文件夹选 `/ (root)`
5. 点击 `Save`

### 第5步：获取链接
等待1-2分钟，刷新页面，你会看到：
```
https://你的用户名.github.io/eav-workbench/
```

把这个链接发给同事，任何人都能访问！

---

## 文件清单

确保上传以下5个文件（缺一不可）：

| 文件名 | 大小 | 说明 |
|--------|------|------|
| index.html | 20KB | 主页面 |
| app.js | 58KB | 逻辑代码 |
| style.css | 23KB | 样式 |
| chart.umd.min.js | 205KB | 图表库（本地化） |
| xlsx.full.min.js | 881KB | Excel处理库（本地化） |

---

## 常见问题

**Q: 页面显示空白？**
A: 等待2-3分钟，GitHub Pages需要时间构建

**Q: 图表不显示？**
A: 检查浏览器控制台是否有JS错误，确保5个文件都上传了

**Q: 数据丢失？**
A: 数据存在浏览器localStorage，每个用户独立，不会共享

---

## 更新代码

修改代码后，重新上传文件到GitHub仓库，Pages会自动更新（等待1-2分钟）

---

**技术支持**：如有问题，联系分析组

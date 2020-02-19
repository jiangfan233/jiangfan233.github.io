---
layout: post
title: golang依赖管理优化
date: 2020-02-19 17:37:30 +0800
tag: golang
---

我们现在项目使用的依赖管理工具为 https://github.com/rancher/trash，虽然trash可缓存模块，但是项目构建拉取依赖的时候，尤其是第一次缓存模块时，有时耗时接近一小时 ... 以下讨论两种方法：

1）对trash进行优化；

2）改变依赖工具为官方的go modules

#### 一、trash拉取依赖的过程

##### 1、解析命令行参数

##### 2、读取vendor.conf中配置，以下为现有项目配置的vendor.conf的内容

```
import:

- package: github.com/gorilla/handlers
  version: v1.4.2
  repo:    http://gitlab.gf.com.cn/golang-repos/gorilla-handlers.git

- package: gitlab.gf.com.cn/golang-modules/hello_world
  repo:    http://gitlab.gf.com.cn/golang_modules/hello_world.git
  version: master
```

package：模块位于modules下的路径；

repo：远程仓库的地址；

version：可以为tag，git commit id，branch

##### 3、缓存包

trash可以带--cache参数后指定缓存目录，默认的缓存路径为 "/Users/ivan/.trash-cache"，第一次缓存时，会临时改变$GPATH变量为--cache指定的目录，使用 `go get -d -f -u "package"`下载依赖，这一步失败了的话，接下来会用`git init  -q`  `git remote add -f "repo"` `git fetch -f -t "repo"` 来完成模块的缓存。

##### 4、copy下载的模块至项目下的vendor目录

##### 5、移除项目未导入的模块，精简代码，以提升项目构建的速度

#### 二、trash的优化

可以看到在trash拉取依赖的过程中，第三部使用了go get。现有网络环境访问github速度比较慢，加之go get会挨个下载模块的依赖包，所以这里是造成trash慢的主要原因。我们要求所有的模块均使用公司gitlab作为远程仓库，避免访问github等外网，所以对以下方法稍加改变：

~~~go
//https://github.com/rancher/trash/blob/master/trash.go#L624

func cloneGitRepo(trashDir, repoDir string, i conf.Import, insecure bool) error {
	logrus.Infof("Preparing cache for '%s'", i.Package)
	os.Chdir(trashDir)
	if err := os.RemoveAll(repoDir); err != nil {
		logrus.WithFields(logrus.Fields{"err": err, "repoDir": repoDir}).Error("os.RemoveAll() failed")
		return err
	}
  /////////////////////////////////////////
	args := []string{"get", "-d", "-f", "-u"}
	if insecure {
		args = append(args, "-insecure")
	}
	args = append(args, i.Package)
	if bytes, err := exec.Command("go", args...).CombinedOutput(); err != nil {
		logrus.WithFields(logrus.Fields{"err": err}).Debugf("`go %s` returned err:\n%s", strings.Join(args, " "), bytes)
	}
  ////////////////////////////////////////
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		logrus.WithFields(logrus.Fields{"err": err, "repoDir": repoDir}).Error("os.MkdirAll() failed")
		return err
	}
	os.Chdir(repoDir)
	if !isCurrentDirARepo(trashDir) {
		logrus.WithFields(logrus.Fields{"repoDir": repoDir}).Debug("not a git repo, creating one")
		exec.Command("git", "init", "-q").Run()
	}
	if i.Repo != "" {
		addRemote(i.Repo)
	}
	return nil
}
~~~

增加--quick -q参数，在此参数下，repo为必须配置项。

安装新的trash：`go get -u github.com/jiangfan233/trash`

#### 三、使用go modules

go modules(https://github.com/golang/go/wiki/Modules)最初于go 1.11发布，于go 1.13得到了丰富与完善。

##### 1、新增内容

###### 1）6个环境变量：

GO111MODULE：

有3个可选值，off、on、auto；

`GO111MODULE=off` 无模块支持，go 会从 GOPATH 和 vendor 文件夹寻找包；
`GO111MODULE=on` 模块支持，go 会忽略 GOPATH 和 vendor 文件夹，只根据 go.mod 下载依赖；
`GO111MODULE=auto` 在 $GOPATH/src 外面且根目录有 go.mod 文件时，开启模块支持。

GOPROXY：设置go模块代理；

国内通常使用七牛云的模块代理最为可靠，设置为 `GOPROXY=https://goproxy.cn,direct`。

GONOPROXY：

跳过goproxy逻辑，设置格式为 `GONOPROXY=*.corp.example.com`

GOSUMDB：

go checksum database，对go 拉取的模块进行校验，防止被篡改，默认值为 `sum.golang.org`，支持被 `goproxy.cn`代理，或者可以选择关闭 `GOSUMDB=off`。

GONOSUMDB：

忽略校验哪些地址下的模块，同gonoproxy一样的设置格式。

GOPRIVATE：

跳过goproxy及gosumdb逻辑，同gonoproxy一样的设置格式。

注：

GONOPROXY、GONOSUMDB、GOPRIVATE均是为了解决私有模块的问题，即go module proxy或者go checksum database无法访问的场景。

###### 2）新增文件

<u>go.mod</u>：

```
module gitlab.gf.com.cn/gfmiddle/demo

go 1.13

require github.com/gorilla/handlers v1.4.2
```

module: 声明包，提供项目模块导入路径；

require：导入的特定版本的模块，go强制语义化版本格式(Semantic Import Versioning)，即 `v(major).(minor).(patch)`的格式。

注：

go官方认为，在语义化版本控制中，v0是开发版本，v1为第一个正式版本，v2相较于v1一般有了break change。所以，应当遵循下面的一些规范：

1、使用语义化版本规范，即tag的格式为 v1.2.3；

2、在导入v2+模块时，需要在更改go.mod文件的格式为` require github.com/my/mod/v2 v2.0.1`，项目导入路径为`import "github.com/my/mod/v2/mypkg`，v0和v1的则不需要。同时go get也可以使用下面格式：`go get github.com/my/mod/v2@v2.0.1`

一些兼容性的操作：

1、`gopkg.in/yaml.v1 and gopkg.in/yaml.v2`这类本身包含了版本信息的依然沿用旧的规则；

2、如果不想更改包的导入路径，`require github.com/my/mod v2.0.1+incompatible`的导入格式可以不改变旧代码包的导入路径；

3、最小版本选择：我们为每个模块指定的依赖都是可用于构建的最低版本，最后实际选择的版本是所有出现过的最低版本中的最大值，其实这样也很懵逼，看下图：

<img src="../../public/image/version-select-list.png">

<u>go.sum</u>：

```
github.com/gorilla/handlers v1.4.2 h1:0QniY0USkHQ1RGCLfKxeNHK9bkDHGRYGNDFBCS+YARg=
github.com/gorilla/handlers v1.4.2/go.mod h1:Qkdc/uu4tH4g6mTK6auzZ766c4CA0Ng8+o/OAirnOIQ=
```

go.sum的格式为：

```
<module> <version> <hash>
<module> <version>/go.mod <hash>
```

前者为 go modules打包整个模块包文件zip后再进行hash值，后者为针对模块下go.mod的hash值。

###### 3）新增命令

运行 `go help mod`

```
Usage:

	go mod <command> [arguments]

The commands are:

	download    download modules to local cache 下载go module文件中指明的所有依赖，当前缓存的目录为$GOPATH/pkg/mod
	edit        edit go.mod from tools or scripts 编辑go.mod文件 eg: go mod edit -require=golang.org/x/text
	graph       print module requirement graphgo 查看所有的依赖
	init        initialize new module in current directory 生成go.mod文件
	tidy        add missing and remove unused modules 整理依赖，运行go mod tidy将添加所有依赖至go mod文件中
	vendor      make vendored copy of dependencies 将依赖复制入项目目录下vendor目录
	verify      verify dependencies have expected content 校验模块
	why         explain why packages or modules are needed 解释为什么需要包和模块，(O_O)?运行了下没发现有啥用
```

##### 2、使用

https://github.com/golang/go/wiki/Modules#how-to-use-modules

##### 3、当前项目迁移至go modules问题

###### 1）基础库未使用符合semver rule的版本号

由于go modules强制语义化版本，之前的模块 eg:

```
- package: github.com/boj/redistore
  repo:    http://gitlab.gf.com.cn/golang-repos/boj-redistore.git
  version: v1.2

- package: gitlab.gf.com.cn/golang-modules/config
  repo:    http://gitlab.gf.com.cn/golang-modules/config.git
  version: v2.0
```

v1.2和v2.0均不符合规范，这里可以按以下配置：

```
github.com/boj/redistore fc113767cd6b051980f260d6dbe84b2740c46ab0
```

运行 go mod tidy 会自动为其生成一个版本号并写入到go.mod文件中：

```
github.com/gorilla/handlers v0.0.0-20161206055144-3a5767ca75ec
```

###### 2）基础库目录下没有 go.mod文件

这里用导入gin来做说明

import gin v1.3.0，该版本目录下不包含go.mod文件，项目root目录执行go mod tidy，生成go.mod为：

```
module gitlab.gf.com.cn/gfmiddle/demo

go 1.13

require (
   github.com/gin-contrib/sse v0.1.0 // indirect
   github.com/gin-gonic/gin v1.3.0
   github.com/golang/protobuf v1.3.3 // indirect
   github.com/json-iterator/go v1.1.9 // indirect
   github.com/mattn/go-isatty v0.0.12 // indirect
   github.com/stretchr/testify v1.4.0 // indirect
   github.com/ugorji/go v1.1.7 // indirect
   golang.org/x/net v0.0.0-20200202094626-16171245cfb2 // indirect
   gopkg.in/go-playground/assert.v1 v1.2.1 // indirect
   gopkg.in/go-playground/validator.v8 v8.18.2 // indirect
   gopkg.in/yaml.v2 v2.2.8 // indirect
)
```

这里，go.mod以标注为 indrect 指明了该模块为间接依赖，其版本均为latest发布的版本，实际上就是gin的依赖模块；

导入 gin v1.5.0：

```
module gitlab.gf.com.cn/gfmiddle/demo

go 1.13

require github.com/gin-gonic/gin v1.5.0
```

所以可以轻易看出来为每个基础库添加go.mod文件的好处，各基础库可以指定各自依赖模块的版本，不用修改了一个库就担心会不会影响另外一个 。

###### 3）v2+版本的模块导入路径问题

```
- package: gitlab.gf.com.cn/golang-modules/request
  repo:    http://gitlab.gf.com.cn/golang-modules/request.git
  version: v2.3
```

要使其符合go modules在导入路径方面的规范，要不是更改旧代码，为其更新到新的导入路径，否则就是在go.mod配置中增加+incompatible后缀。

###### 4）ci

设置 `GOPRIVATE=gitlab.gf.com.cn/*`拉取基础库代码，在项目目录下运行go build -x：

```
lxdeMacBook-Pro-5:demo jiang$ go build -x
WORK=/var/folders/1y/64rb620j49398vfz8rq6kx300000gp/T/go-build873278309
# get https://gitlab.gf.com.cn/golang-modules/hello?go-get=1
# get https://gitlab.gf.com.cn/golang-modules?go-get=1
# get //gitlab.gf.com.cn/golang-modules?go-get=1: Get https://gitlab.gf.com.cn/golang-modules?go-get=1: dial tcp 192.168.124.14:443: connect: connection refused
# get //gitlab.gf.com.cn/golang-modules/hello?go-get=1: Get https://gitlab.gf.com.cn/golang-modules/hello?go-get=1: dial tcp 192.168.124.14:443: connect: connection refused
# get https://goproxy.cn/gitlab.gf.com.cn/@v/list
# get https://goproxy.cn/gitlab.gf.com.cn/@v/list: 404 Not Found (5.920s)
# get https://gitlab.gf.com.cn/golang-modules?go-get=1
# get https://gitlab.gf.com.cn/?go-get=1
# get https://gitlab.gf.com.cn/golang-modules/hello?go-get=1
# get //gitlab.gf.com.cn/?go-get=1: Get https://gitlab.gf.com.cn/?go-get=1: dial tcp 192.168.124.14:443: connect: connection refused
# get //gitlab.gf.com.cn/golang-modules/hello?go-get=1: Get https://gitlab.gf.com.cn/golang-modules/hello?go-get=1: dial tcp 192.168.124.14:443: connect: connection refused
# get //gitlab.gf.com.cn/golang-modules?go-get=1: Get https://gitlab.gf.com.cn/golang-modules?go-get=1: dial tcp 192.168.124.14:443: connect: connection refused
build gitlab.gf.com.cn/gfmiddle/demo: cannot load gitlab.gf.com.cn/golang-modules/hello: cannot find module providing package gitlab.gf.com.cn/golang-modules/hello
```

可以看到实际访问的是 `https://gitlab.gf.com.cn/golang-modules/hello?go-get=1`，而我们的gitlab仅支持http。具体参考：https://github.com/golang/go/issues/32966

##### 4、结论

1）当前无法迁移至go modules，无法解决ci拉取基础库代码的问题，等待go 1.14 ... 大佬们已承诺支持从insecure的仓库拉代码；

2）旧的项目迁移至go modules有点麻烦，要支持go modules，首先应该对基础库进行一波更新，直接上会很勉强。
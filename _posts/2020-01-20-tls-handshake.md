---
layout: post
title: tls握手
date: 2020-01-20 14:53:07 +0800
tag: 网络
---
### 一、Diffie-Hellman秘钥交换

假设有3个人，Alice，Bob，和Eve，其中Alice和Bob为通信的两方，Eve为想窃取秘钥的中间人

1、Alice和Bob约定`g=3 p=17`，这些信息是公开的，Eve也知道；

2、Alice生成一个随机数 `15`，计算` 3^15 mod 17 = b`，将`b`发送到Bob，这个过程可被Eve窃取；

3、Bob生成一个随机数`13`，计算 `3^13 mod 17 = a`，将`a`发送至Alice，这个过程同样可被Eve窃取；

4、然后Alice计算` key1 = a^15 mode 17 = (3^13 mod 17)^15 mod 17 = 3^(13*15) mod 17`，Bob也可以计算 `key2 = b^13 mod 17 = (3^15 mod 17)^13 mod 17 = 3^(15 * 13) mod 17`，key1 = key2，即为https加密过程中使用的共享秘钥；

5、Eve如果想要拿到秘钥，只能根据` a、g、p`计算出Bob生成的随机数`13`或者`b、g、p`计算出Alice生成的随机数`15`，但是这样所需的计算量超级大（具体我也不知道为啥，这里只是为后面理解共享秘钥的交换原理稍加解释，避免一头雾水，具体数学原理不做深究），所以这样避免了中间人Eve窃取加密的共享秘钥的可能。

### 二、抓包分析

chrom地址栏访问 https://www.baidu.com

这里可以把浏览器看做Alice，服务器看做Bob

1、域名解析

首先浏览器访问dns服务器，服务器返回 baidu.com 域名对应的ip为 14.215.177.39 14.215.177.38

<img src="../../public/image/dns_solution.png">

2、tcp三次握手

<img src="../../public/image/three_handshake.png">

3、tls握手

1）客户端发送client hello报文

<img src="../../public/image/client_hello.png">

2）服务器响应hello报文

<img src="../../public/image/server_hello.png">

3）服务器发送证书

<img src="../../public/image/certificate.png">

客户端将验证证书签名，并获取服务器公钥

4）服务器密码交换

<img src="../../public/image/server_key_exchange.png">

5）服务器发送server hello done

<img src="../../public/image/server_hello_done.png">

6）客户端密码交换

<img src="../../public/image/client_key_exchange.png">

到达这一步以后，客户端与服务器都达到了共同的 Pre-Master Secret（预主密码），然后通过cline hello和server_hello中的随机数生成Master Secret：

```
master_secret = PRF（pre_master_secret，“master secret”，ClientHello.random + ServerHello.random）[0..47]
```

7）验证通过之后，服务器同样发送 change_cipher_spec 以告知客户端后续的通信都采用协商的密钥与算法进行加密通信， 服务器也结合所有当前的通信参数信息生成一段数据并采用协商密钥 session secret 与算法加密并发送到客户端，客户端计算所有接收信息的 hash 值，并采用协商密钥解密 encrypted_handshake_message，验证服务器发送的数据和密钥，验证通过则握手完成

<img src="../../public/image/shake_end.png">

### 三、go http对于tls握手的实现(相关源码复杂，这里简单做下笔记)

1、使用下面方法开启服务进程的时候，将建立https会话

~~~go
// addr:tcp监听端口 certFile:证书 keyFile:私钥 handler:多路复用器
func ListenAndServeTLS(addr, certFile, keyFile string, handler Handler) error {
	server := &Server{Addr: addr, Handler: handler}
	return server.ListenAndServeTLS(certFile, keyFile)
}
~~~

2、实现tls握手

~~~go
// 实现了从客户端到服务器的tls握手及服务器到客户端的tls握手
func (c *Conn) Handshake() error {
	c.handshakeMutex.Lock()
	defer c.handshakeMutex.Unlock()

	if err := c.handshakeErr; err != nil {
		return err
	}
	if c.handshakeComplete() {
		return nil
	}

	c.in.Lock()
	defer c.in.Unlock()

	if c.isClient {
	  // 客户端->服务器
		c.handshakeErr = c.clientHandshake()
	} else {
		// 服务器->客户端
		c.handshakeErr = c.serverHandshake()
	}
	if c.handshakeErr == nil {
		c.handshakes++
	} else {
		// 握手期间出现错误清除缓冲区的数据
		c.flush()
	}

	if c.handshakeErr == nil && !c.handshakeComplete() {
		panic("handshake should have had a result.")
	}

	return c.handshakeErr
}
~~~

3、服务器->客户端 tls握手

~~~go
func (c *Conn) serverHandshake() error {
   // 第一次握手生成 session ticket相关秘钥及session id
   c.config.serverInitOnce.Do(func() { c.config.serverInit(nil) })

   hs := serverHandshakeState{
      c: c,
   }
   // 是否重新握手
   isResume, err := hs.readClientHello()
   if err != nil {
      return err
   }

   // For an overview of TLS handshaking, see https://tools.ietf.org/html/rfc5246#section-7.3
   c.buffering = true
   if isResume {
      // 客户端已经有了session ticket,所以只需进行不完全的tls握手即可
      if err := hs.doResumeHandshake(); err != nil {
         return err
      }
      if err := hs.establishKeys(); err != nil {
         return err
      }
      // 向客户端重新发送一个ticket
      if hs.hello.ticketSupported {
         if err := hs.sendSessionTicket(); err != nil {
            return err
         }
      }
      // 发送change_cipher_spec报文
      if err := hs.sendFinished(c.serverFinished[:]); err != nil {
         return err
      }
      // 清除缓冲区数据
      if _, err := c.flush(); err != nil {
         return err
      }
      c.clientFinishedIsFirst = false
      // 读取客户端报文，结束握手
      if err := hs.readFinished(nil); err != nil {
         return err
      }
      c.didResume = true
   } else {
      // 客户端不包含session ticket,进行完全握手
      if err := hs.doFullHandshake(); err != nil {
         return err
      }
      if err := hs.establishKeys(); err != nil {
         return err
      }
      if err := hs.readFinished(c.clientFinished[:]); err != nil {
         return err
      }
      c.clientFinishedIsFirst = true
      c.buffering = true
      if err := hs.sendSessionTicket(); err != nil {
         return err
      }
      if err := hs.sendFinished(nil); err != nil {
         return err
      }
      if _, err := c.flush(); err != nil {
         return err
      }
   }
	 // 生成主秘钥
   c.ekm = ekmFromMasterSecret(c.vers, hs.suite, hs.masterSecret, hs.clientHello.random, hs.hello.random)
   atomic.StoreUint32(&c.handshakeStatus, 1)

   return nil
}
~~~

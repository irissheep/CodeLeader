import fs from 'node:fs/promises';
import path from 'node:path';
import {guard,root as projectRoot} from './common.mjs';guard();
const root=path.join(projectRoot,'.tmp/verification-cross-project/parcel-project');
const files={
 'server/pom.xml':'<project><groupId>org.parcel</groupId><artifactId>parcel-api</artifactId><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies><build><sourceDirectory>domain-src</sourceDirectory><testSourceDirectory>checks</testSourceDirectory></build></project>',
 'server/domain-src/org/tests/parcel/ParcelApp.java':'package org.tests.parcel; import org.springframework.boot.autoconfigure.SpringBootApplication; @SpringBootApplication public class ParcelApp { public static void main(String[] args) {} }',
 'server/domain-src/org/tests/parcel/ParcelTest.java':'package org.tests.parcel; import org.springframework.web.bind.annotation.*; @RestController @RequestMapping("/parcels") public class ParcelTest { private final ParcelService service; public ParcelTest(ParcelService service){this.service=service;} @GetMapping public String all(){return service.all();} }',
 'server/domain-src/org/tests/parcel/ParcelService.java':'package org.tests.parcel; import org.springframework.stereotype.Service; @Service public class ParcelService { public String all(){return "none";} }',
 'server/checks/org/tests/parcel/ParcelCheck.java':'package org.tests.parcel; public class ParcelCheck { public void check(){} }',
 'client/package.json':'{"name":"parcel-ui","dependencies":{"vue":"3","@vue/cli-service":"5"}}',
 'client/src/App.vue':'<template><main>Parcel</main></template>',
 'server/src/main/resources/application.properties':'server.port=18463\nspring.application.name=parcel-api\n'
};
for(const [file,text] of Object.entries(files)){const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);}
console.log(root);

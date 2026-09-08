"""Generate the dependency-free Xcode project. Run after changing target files."""
from pathlib import Path
import json
import re
root = Path(__file__).resolve().parents[1] / 'ios'
existing = root / 'MyTube.xcodeproj/project.pbxproj'
team = re.search(r'DEVELOPMENT_TEAM[\"]?\s*=\s*[\"]?([A-Z0-9]{10})', existing.read_text()) if existing.exists() else None
objects = {}; count = 0
def obj(isa, **fields):
 global count
 count += 1; key = f'{count:024X}'; objects[key] = dict(isa=isa, **fields); return key
def ref(path, kind): return obj('PBXFileReference', lastKnownFileType=kind, path=path, sourceTree='<group>')
def build(ref): return obj('PBXBuildFile', fileRef=ref)
config = ref('Config.xcconfig','text.xcconfig')
files = {p:ref(p,'sourcecode.swift') for p in ['MyTube/App.swift','MyTube/LocalServer.swift','MyTube/LocalStore.swift','Shared/SharedInbox.swift','ShareExtension/ShareViewController.swift','Tests/AppTests.swift']}
web=ref('Web','folder')
assets=ref('MyTube/Assets.xcassets','folder.assetcatalog')
products = [obj('PBXFileReference',explicitFileType=t,path=p,sourceTree='BUILT_PRODUCTS_DIR') for p,t in [('MyTube.app','wrapper.application'),('MyTubeShare.appex','wrapper.app-extension'),('MyTubeTests.xctest','wrapper.cfbundle')]]
group=obj('PBXGroup',children=[config,*files.values(),web,assets],sourceTree='<group>')
pg=obj('PBXGroup',children=products,name='Products',sourceTree='<group>'); objects[group]['children'].append(pg)
def configs(settings):
 return obj('XCConfigurationList',buildConfigurations=[obj('XCBuildConfiguration',baseConfigurationReference=config,buildSettings={**({'DEVELOPMENT_TEAM':team.group(1)} if team else {}),**settings,**({'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG','SWIFT_OPTIMIZATION_LEVEL':'-Onone'} if name=='Debug' else {'SWIFT_COMPILATION_MODE':'wholemodule'})},name=name) for name in ['Debug','Release']],defaultConfigurationIsVisible=0,defaultConfigurationName='Release')
project=obj('PBXProject',attributes={'LastUpgradeCheck':'2660'},buildConfigurationList=configs({'SDKROOT':'iphoneos','CLANG_ENABLE_MODULES':'YES'}),compatibilityVersion='Xcode 14.0',developmentRegion='en',knownRegions=['en','Base'],mainGroup=group,productRefGroup=pg,projectDirPath='',projectRoot='',targets=[])
def target(name,product,paths,settings,kind):
 sources=obj('PBXSourcesBuildPhase',buildActionMask=2147483647,files=[build(files[p]) for p in paths],runOnlyForDeploymentPostprocessing=0)
 resources=obj('PBXResourcesBuildPhase',buildActionMask=2147483647,files=([build(web),build(assets)] if name=='MyTube' else []),runOnlyForDeploymentPostprocessing=0)
 return obj('PBXNativeTarget',buildConfigurationList=configs(settings),buildPhases=[sources,resources],buildRules=[],dependencies=[],name=name,productName=name,productReference=product,productType=kind)
ext=target('MyTubeShare',products[1],['Shared/SharedInbox.swift','ShareExtension/ShareViewController.swift'],{'PRODUCT_BUNDLE_IDENTIFIER':'$(MYTUBE_BUNDLE_ID).share','PRODUCT_NAME':'$(TARGET_NAME)','INFOPLIST_FILE':'ShareExtension/Info.plist','CODE_SIGN_ENTITLEMENTS':'ShareExtension/Share.entitlements','APPLICATION_EXTENSION_API_ONLY':'YES','SKIP_INSTALL':'YES'},'com.apple.product-type.app-extension')
app=target('MyTube',products[0],['MyTube/App.swift','MyTube/LocalServer.swift','MyTube/LocalStore.swift','Shared/SharedInbox.swift'],{'PRODUCT_BUNDLE_IDENTIFIER':'$(MYTUBE_BUNDLE_ID)','PRODUCT_NAME':'$(TARGET_NAME)','INFOPLIST_FILE':'MyTube/Info.plist','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','CODE_SIGN_ENTITLEMENTS':'MyTube/MyTube.entitlements'},'com.apple.product-type.application')
proxy=obj('PBXContainerItemProxy',containerPortal=project,proxyType=1,remoteGlobalIDString=ext,remoteInfo='MyTubeShare')
objects[app]['dependencies']=[obj('PBXTargetDependency',target=ext,targetProxy=proxy)]
embed=build(products[1]);objects[embed]['settings']={'ATTRIBUTES':['RemoveHeadersOnCopy']}
objects[app]['buildPhases'].append(obj('PBXCopyFilesBuildPhase',buildActionMask=2147483647,dstPath='',dstSubfolderSpec=13,files=[embed],name='Embed Share Extension',runOnlyForDeploymentPostprocessing=0))
tests=target('MyTubeTests',products[2],['Tests/AppTests.swift','Shared/SharedInbox.swift','MyTube/LocalStore.swift'],{'PRODUCT_BUNDLE_IDENTIFIER':'$(MYTUBE_BUNDLE_ID).tests','PRODUCT_NAME':'$(TARGET_NAME)','GENERATE_INFOPLIST_FILE':'YES','TEST_TARGET_NAME':'MyTube'},'com.apple.product-type.bundle.ui-testing')
proxy=obj('PBXContainerItemProxy',containerPortal=project,proxyType=1,remoteGlobalIDString=app,remoteInfo='MyTube')
objects[tests]['dependencies']=[obj('PBXTargetDependency',target=app,targetProxy=proxy)]
objects[project]['targets']=[app,ext,tests]
def fmt(x):
 if isinstance(x,dict): return '{ '+ ' '.join(f'{json.dumps(k)} = {fmt(v)};' for k,v in x.items())+' }'
 if isinstance(x,list): return '('+', '.join(fmt(v) for v in x)+')'
 return json.dumps(str(x))
p=root/'MyTube.xcodeproj';p.mkdir(exist_ok=True)
(p/'project.pbxproj').write_text('// !$*UTF8*$!\n'+fmt({'archiveVersion':1,'classes':{},'objectVersion':56,'objects':objects,'rootObject':project})+'\n')
scheme=p/'xcshareddata/xcschemes';scheme.mkdir(parents=True,exist_ok=True)
def item(id,name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{id}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:MyTube.xcodeproj"/>'
(scheme/'MyTube.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2660" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{item(app,'MyTube.app')}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{item(tests,'MyTubeTests.xctest')}</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{item(app,'MyTube.app')}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{item(app,'MyTube.app')}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
